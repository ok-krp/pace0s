import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:pace/core/storage/local_store.dart';
import 'package:pace/core/supabase/pace_supabase.dart';
import 'package:pace/core/sync/sync_service.dart';
import 'package:pace/features/ai/ai_service.dart';

void main() {
  late Directory directory;

  setUp(() async {
    directory = await Directory.systemTemp.createTemp('pace-local-store-test-');
  });

  tearDown(() async {
    if (await directory.exists()) await directory.delete(recursive: true);
  });

  test('queued timestamps advance when the clock repeats or moves backwards', () {
    final latest = DateTime.utc(2026, 10, 17, 10, 0, 0, 0, 123);
    expect(
      LocalStore.monotonicQueuedAt(now: latest, latestKnownAt: latest),
      latest.add(const Duration(microseconds: 1)),
    );
    expect(
      LocalStore.monotonicQueuedAt(
        now: latest.subtract(const Duration(seconds: 1)),
        latestKnownAt: latest,
      ),
      latest.add(const Duration(microseconds: 1)),
    );
    final newerNow = latest.add(const Duration(microseconds: 10));
    expect(
      LocalStore.monotonicQueuedAt(now: newerNow, latestKnownAt: latest),
      newerNow,
    );
  });

  test('strictly validates queued timestamp components and offsets', () {
    final valid = <String, dynamic>{
      'key': 'pace.profile.name',
      'value': 'value',
      'operation': 'upsert',
      'queuedAt': '2026-10-18T10:00:00+02:00',
    };
    expect(LocalStore.isValidOutboxOperation(valid), isTrue);

    for (final timestamp in [
      '2026-02-30T10:00:00Z',
      '2026-13-01T10:00:00Z',
      '2026-10-18T25:00:00Z',
      '2026-10-18T10:61:00Z',
      '2026-10-18T10:00:61Z',
      '2026-10-18T10:00:00+99:99',
      '0000-01-01T00:00:00Z',
      '2026-10-18T10:00:00+14:30',
      '2026-10-18T10:00:00-15:00',
    ]) {
      expect(
        LocalStore.isValidOutboxOperation({...valid, 'queuedAt': timestamp}),
        isFalse,
        reason: 'must reject malformed timestamp: $timestamp',
      );
    }
  });

  test('invalid timestamps cannot poison the next queued write', () async {
    final store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    final invalidFutureTimestamp =
        '${DateTime.now().toUtc().year}-12-42T23:59:59Z';

    // Both reserved sync metadata and a malformed outbox entry are untrusted
    // local JSON. Neither may push a fresh mutation into a future year.
    await store.write(
      '__sync_meta',
      {'pace.profile.name': invalidFutureTimestamp},
      enqueueSync: false,
    );
    await store.write(
      '__outbox',
      <dynamic>[
        {
          'key': 'pace.profile.name',
          'operation': 'upsert',
          'queuedAt': invalidFutureTimestamp,
        },
      ],
      enqueueSync: false,
    );

    final before = DateTime.now().toUtc();
    await store.write('pace.profile.name', 'safe replacement');
    final queuedAt = DateTime.parse(
      store.pendingOperations().single['queuedAt'] as String,
    );

    expect(queuedAt.isAfter(before.subtract(const Duration(minutes: 1))), isTrue);
    expect(queuedAt.isBefore(before.add(const Duration(days: 1))), isTrue);
    final quarantine = store.read('__outbox_quarantine') as List;
    expect(quarantine, hasLength(1));
    expect(quarantine.single['reason'], 'malformed-outbox-operation-replaced');
  });

  test('acknowledging an accepted write records its server timestamp', () async {
    final store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    await store.write('pace.profile.name', 'account A');
    final operation = store.pendingOperations().single;
    final queuedAt = operation['queuedAt'] as String;

    await store.acknowledgeOperation(
      operation,
      expectedUserId: 'user-a',
      syncedAt: queuedAt,
    );

    expect(store.lastSyncedAt('pace.profile.name'), queuedAt);
    expect(store.pendingOperations(), isEmpty);
  });

  test('rejects malformed remote timestamps before changing local state', () async {
    final store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    await store.write('pace.profile.name', 'local value', enqueueSync: false);

    await expectLater(
      store.applyRemote(
        'pace.profile.name',
        'invalid remote value',
        '2026-13-01T10:00:00Z',
        expectedUserId: 'user-a',
      ),
      throwsA(isA<FormatException>()),
    );
    expect(store.read('pace.profile.name'), 'local value');
    expect(store.lastSyncedAt('pace.profile.name'), isNull);
  });
  test('late acknowledgements cannot move synced metadata backwards', () async {
    final store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    await store.write('pace.profile.name', 'first value');
    final olderOperation = store.pendingOperations().single;

    await store.write('pace.profile.name', 'newer value');
    final newerOperation = store.pendingOperations().single;
    final newerServerTimestamp = DateTime.now()
        .toUtc()
        .add(const Duration(days: 1))
        .toIso8601String();
    await store.acknowledgeOperation(
      newerOperation,
      expectedUserId: 'user-a',
      syncedAt: newerServerTimestamp,
    );

    await store.acknowledgeOperation(
      olderOperation,
      expectedUserId: 'user-a',
      syncedAt: DateTime.now().toUtc().toIso8601String(),
    );

    expect(store.read('pace.profile.name'), 'newer value');
    expect(store.lastSyncedAt('pace.profile.name'), newerServerTimestamp);
    expect(store.pendingOperations(), isEmpty);
  });

  test('rebases a concurrent edit after the server acknowledges a later timestamp', () async {
    final store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    await store.write('pace.profile.name', 'first value');
    final inFlight = store.pendingOperations().single;

    // This local edit arrives while the first request is in flight. Its
    // queuedAt predates the server's authoritative timestamp returned later.
    await store.write('pace.profile.name', 'newer local value');
    final beforeAck = store.pendingOperations().single;
    expect(store.isPendingOperation(inFlight), isFalse);
    expect(store.isPendingOperation(beforeAck), isTrue);
    final serverUpdatedAt = DateTime.now()
        .toUtc()
        .add(const Duration(days: 1))
        .toIso8601String();
    expect(DateTime.parse(beforeAck['queuedAt'] as String).isBefore(DateTime.parse(serverUpdatedAt)), isTrue);

    await store.acknowledgeOperation(
      inFlight,
      expectedUserId: 'user-a',
      syncedAt: serverUpdatedAt,
    );

    final remaining = store.pendingOperations();
    expect(remaining, hasLength(1));
    expect(remaining.single['value'], 'newer local value');
    expect(
      DateTime.parse(remaining.single['queuedAt'] as String).isAfter(DateTime.parse(serverUpdatedAt)),
      isTrue,
    );
    expect(store.lastSyncedAt('pace.profile.name'), serverUpdatedAt);
  });

  test('malformed per-key sync metadata is ignored without crashing', () async {
    final store = await LocalStore.open(directory: directory);
    await store.write(
      '__sync_meta',
      {
        'pace.profile.name': 123,
        'pace.profile.weight': '2026-10-17T10:00:00Z',
      },
      enqueueSync: false,
    );

    expect(store.lastSyncedAt('pace.profile.name'), isNull);
    expect(
      store.lastSyncedAt('pace.profile.weight'),
      '2026-10-17T10:00:00Z',
    );
    expect(
      store.syncedMetadata(),
      {'pace.profile.weight': '2026-10-17T10:00:00Z'},
    );
  });

  test('malformed outbox operation is quarantined without losing its payload', () async {
    final store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    final malformed = <String, dynamic>{
      'value': <String, dynamic>{'important': 'preserve-me'},
      'operation': 'unknown-operation',
      'queuedAt': '2026-10-18T10:00:00Z',
    };
    await store.write('__outbox_quarantine', 'preserve-this-legacy-payload', enqueueSync: false);
    await store.write('__outbox', <dynamic>[malformed], enqueueSync: false);

    await store.quarantineOperation(
      malformed,
      expectedUserId: 'user-a',
      reason: 'invalid-outbox-operation-shape',
    );

    expect(store.pendingOperations(), isEmpty);
    final quarantine = store.read('__outbox_quarantine') as List;
    expect(quarantine, hasLength(2));
    expect(quarantine.first['reason'], 'malformed-quarantine-container');
    expect(quarantine.first['operation'], 'preserve-this-legacy-payload');
    expect(quarantine.last['reason'], 'invalid-outbox-operation-shape');
    expect(quarantine.last['operation']['value']['important'], 'preserve-me');
  });

  test('replacing a malformed same-key upsert preserves its original payload', () async {
    final store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    final malformed = <String, dynamic>{
      'key': 'pace.profile.name',
      'queuedAt': '2026-01-01T00:00:00Z',
      'operation': 'upsert',
    };
    await store.write('__outbox', <dynamic>[malformed], enqueueSync: false);

    await store.write('pace.profile.name', 'corrected value');

    final pending = store.pendingOperations();
    expect(pending, hasLength(1));
    expect(pending.single['value'], 'corrected value');
    final quarantine = store.read('__outbox_quarantine') as List;
    expect(quarantine, hasLength(1));
    expect(quarantine.single['reason'], 'malformed-outbox-operation-replaced');
    expect(quarantine.single['operation'], malformed);
  });

  test('malformed outbox field does not crash local reads or sync inspection', () async {
    final store = await LocalStore.open(directory: directory);
    await store.write('pace.profile.name', 'recoverable value', enqueueSync: false);
    await store.write('__outbox', 'not-a-list', enqueueSync: false);

    expect(store.read('pace.profile.name'), 'recoverable value');
    expect(store.pendingOperations(), isEmpty);
    expect(store.hasPendingOperationForKey('pace.profile.name'), isFalse);
    final quarantine = store.read('__outbox_quarantine') as List;
    expect(quarantine, hasLength(1));
    expect(quarantine.single['reason'], 'malformed-outbox-container');
    expect(quarantine.single['operation'], 'not-a-list');

    // The next normal mutation repairs the reserved field while preserving the
    // malformed original value in the local quarantine.
    await store.write('pace.profile.weight', 53);
    expect(store.pendingOperations(), hasLength(1));
    expect(store.pendingOperations().single['key'], 'pace.profile.weight');
  });

  test('a normal durable mutation persists outbox repairs without a sync pass', () async {
    var store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    await store.write('__outbox', <dynamic>['keep this payload'], enqueueSync: false);

    expect(store.pendingOperations(), isEmpty);
    await store.write('pace.profile.name', 'durable repair', enqueueSync: false);

    store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    expect(store.read('pace.profile.name'), 'durable repair');
    expect(store.read('__outbox'), isEmpty);
    final quarantine = store.read('__outbox_quarantine') as List;
    expect(quarantine, hasLength(1));
    expect(quarantine.single['operation'], 'keep this payload');
  });

  test('malformed outbox container quarantine survives restart', () async {
    var store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    await store.write('__outbox', 'not-a-list', enqueueSync: false);

    expect(store.pendingOperations(), isEmpty);
    await store.persistOutboxRepairs(expectedUserId: 'user-a');

    store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    expect(store.read('__outbox'), isEmpty);
    final quarantine = store.read('__outbox_quarantine') as List;
    expect(quarantine, hasLength(1));
    expect(quarantine.single['reason'], 'malformed-outbox-container');
    expect(quarantine.single['operation'], 'not-a-list');
  });

  test('outbox quarantine repairs survive restart when no valid operation remains', () async {
    var store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    await store.write(
      '__outbox',
      <dynamic>['preserve-across-restart'],
      enqueueSync: false,
    );

    expect(store.pendingOperations(), isEmpty);
    await store.persistOutboxRepairs(expectedUserId: 'user-a');

    store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    expect(store.pendingOperations(), isEmpty);
    final quarantine = store.read('__outbox_quarantine') as List;
    expect(quarantine, hasLength(1));
    expect(quarantine.single['reason'], 'malformed-outbox-entry');
    expect(quarantine.single['operation'], 'preserve-across-restart');
    expect(store.read('__outbox'), isEmpty);
  });

  test('non-map outbox entries are quarantined rather than silently dropped', () async {
    final store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    await store.write(
      '__outbox',
      <dynamic>['preserve-this-entry'],
      enqueueSync: false,
    );

    expect(store.pendingOperations(), isEmpty);
    final quarantine = store.read('__outbox_quarantine') as List;
    expect(quarantine, hasLength(1));
    expect(quarantine.single['reason'], 'malformed-outbox-entry');
    expect(quarantine.single['operation'], 'preserve-this-entry');
  });

  test('notifies listeners for durable state changes but can batch remote pulls', () async {
    final store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    var notifications = 0;
    store.addListener(() => notifications++);

    await store.write('pace.profile.name', 'local');
    expect(notifications, 1);

    await store.write('pace.__sync_last_pull_at', '2026-10-17T10:00:00Z',
        enqueueSync: false, notify: false);
    expect(notifications, 1);

    await store.applyRemote(
      'pace.profile.name',
      'remote',
      '2026-10-17T10:01:00Z',
      expectedUserId: 'user-a',
    );
    expect(notifications, 2);

    await store.applyRemote(
      'pace.profile.other',
      'remote',
      '2026-10-17T10:02:00Z',
      expectedUserId: 'user-a',
      notify: false,
    );
    expect(notifications, 2);

    store.notifyStateChanged();
    expect(notifications, 3);
  });

  test('guest and signed-in accounts use isolated state and outboxes', () async {
    final store = await LocalStore.open(directory: directory);

    await store.write('pace.profile.name', 'guest');
    expect(store.pendingOperations(), hasLength(1));

    await store.activateAccount('user-a');
    expect(store.read('pace.profile.name'), isNull);
    expect(store.pendingOperations(), isEmpty);

    await store.write('pace.profile.name', 'account A');
    expect(store.pendingOperations(), hasLength(1));

    await store.activateAccount('user-b');
    expect(store.read('pace.profile.name'), isNull);
    expect(store.pendingOperations(), isEmpty);

    await store.write('pace.profile.name', 'account B');
    await store.activateAccount('user-a');
    expect(store.read('pace.profile.name'), 'account A');
    expect(store.pendingOperations(), hasLength(1));

    await store.activateAccount(null);
    expect(store.read('pace.profile.name'), 'guest');
    expect(store.pendingOperations(), hasLength(1));
  });

  test('account filename escaping cannot collide with a literal user ID', () async {
    final store = await LocalStore.open(directory: directory);

    // Under the previous underscore-only suffix, these IDs both mapped to
    // pace_local_user_a__dXNlci9h.json and could share private local state.
    await store.activateAccount('user/a');
    await store.write('pace.profile.name', 'private to slash ID');
    expect(store.read('pace.profile.name'), 'private to slash ID');

    await store.activateAccount('user_a__dXNlci9h');
    expect(store.read('pace.profile.name'), isNull);
    await store.write('pace.profile.name', 'private to literal ID');

    await store.activateAccount('user/a');
    expect(store.read('pace.profile.name'), 'private to slash ID');
    await store.activateAccount('user_a__dXNlci9h');
    expect(store.read('pace.profile.name'), 'private to literal ID');
  });
  test('ambiguous legacy account files are not assigned to either colliding ID', () async {
    final legacyCollision = File(
      '${directory.path}/pace_local_user_a__dXNlci9h.json',
    );
    await legacyCollision.writeAsString(
      '{"pace.profile.name":"ambiguous legacy value"}',
      flush: true,
    );
    final store = await LocalStore.open(directory: directory);

    await store.activateAccount('user/a');
    expect(store.read('pace.profile.name'), isNull);
    await store.activateAccount('user_a__dXNlci9h');
    expect(store.read('pace.profile.name'), isNull);

    // The ambiguous legacy file is preserved for manual recovery rather than
    // silently exposing its contents to whichever account signs in first.
    expect(await legacyCollision.exists(), isTrue);
  });
  test('blocks writes immediately when an account switch is requested', () async {
    final store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    await store.write('pace.profile.name', 'account A');

    final switching = store.activateAccount('user-b');
    await expectLater(
      store.write('pace.profile.name', 'late write'),
      throwsA(isA<StateError>()),
    );
    // The scoped helper must fail closed too while the switch is queued,
    // even though account A is still the active ID until its file flush ends.
    await store.writeForAccount('user-a', 'pace.profile.name', 'late scoped write');
    await store.removeForAccount('user-a', 'pace.profile.name');
    await switching;

    expect(store.activeUserId, 'user-b');
    expect(store.read('pace.profile.name'), isNull);
    expect(store.pendingOperations(), isEmpty);
  });

  test('failed outbox operations use bounded exponential retry backoff', () async {
    final store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    await store.write('pace.profile.name', 'account A');
    final operation = store.pendingOperations().single;
    final now = DateTime.utc(2026, 10, 16, 10);

    await store.deferOperation(operation, expectedUserId: 'user-a', now: now);
    expect(store.pendingOperations(now: now), isEmpty);
    expect(store.hasPendingOperationForKey('pace.profile.name'), isTrue);
    expect(store.hasPendingOperationForKey('pace.profile.other'), isFalse);
    expect(store.hasDueOperationForKey('pace.profile.name', now: now), isFalse);
    expect(store.hasDueOperationForKey('pace.profile.other', now: now), isFalse);
    expect(store.pendingOperations(now: now.add(const Duration(seconds: 4))), isEmpty);
    final due = store.pendingOperations(now: now.add(const Duration(seconds: 5)));
    expect(store.hasDueOperationForKey('pace.profile.name', now: now.add(const Duration(seconds: 5))), isTrue);
    expect(due, hasLength(1));
    expect(due.single['attempts'], 1);
    expect(due.single['nextAttemptAt'], isA<String>());

    await store.deferOperation(due.single, expectedUserId: 'user-a', now: now.add(const Duration(seconds: 5)));
    expect(store.pendingOperations(now: now.add(const Duration(seconds: 14))), isEmpty);
    final dueAgain = store.pendingOperations(now: now.add(const Duration(seconds: 15)));
    expect(dueAgain, hasLength(1));
    expect(store.hasPendingOperationForKey('pace.profile.name'), isTrue);

    await store.acknowledgeOperation(dueAgain.single, expectedUserId: 'user-a');
    expect(store.hasPendingOperationForKey('pace.profile.name'), isFalse);
  });

  test('malformed retry metadata is normalized instead of crashing', () async {
    final store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    await store.write('pace.profile.name', 'account A');
    final original = store.pendingOperations().single;
    await store.write(
      '__outbox',
      <Map<String, dynamic>>[
        <String, dynamic>{
          ...original,
          'attempts': 'invalid',
          'nextAttemptAt': '${DateTime.now().toUtc().year}-13-01T10:00:00Z',
        },
      ],
      enqueueSync: false,
    );

    final malformed = store.pendingOperations().single;
    // Invalid overflow dates must be treated as due, not parsed into a future
    // deadline that could strand this local edit until the clock catches up.
    expect(store.hasDueOperationForKey('pace.profile.name'), isTrue);
    final now = DateTime.utc(2026, 10, 18, 10);
    await store.deferOperation(malformed, expectedUserId: 'user-a', now: now);

    final deferred = store.pendingOperations(now: now.add(const Duration(seconds: 4)));
    expect(deferred, isEmpty);
    final due = store.pendingOperations(now: now.add(const Duration(seconds: 5)));
    expect(due, hasLength(1));
    expect(due.single['attempts'], 1);
    expect(
      DateTime.parse(due.single['nextAttemptAt'] as String),
      now.add(const Duration(seconds: 5)),
    );
  });

  test('retry backoff is capped at fifteen minutes', () async {
    final store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    await store.write('pace.profile.name', 'account A');

    var now = DateTime.utc(2026, 10, 16, 10);
    var operation = store.pendingOperations(now: now).single;
    for (var attempt = 0; attempt < 10; attempt++) {
      await store.deferOperation(operation, expectedUserId: 'user-a', now: now);
      final delaySeconds = (5 * (1 << attempt.clamp(0, 8).toInt())).clamp(5, 900).toInt();
      now = now.add(Duration(seconds: delaySeconds));
      operation = store.pendingOperations(now: now).single;
    }

    await store.deferOperation(operation, expectedUserId: 'user-a', now: now);
    operation = store.pendingOperations(now: now.add(const Duration(seconds: 900))).single;
    final nextAttempt = DateTime.parse(operation['nextAttemptAt'] as String);
    expect(nextAttempt.difference(now), const Duration(seconds: 900));
    expect(store.pendingOperations(now: now.add(const Duration(seconds: 899))), isEmpty);
    expect(store.pendingOperations(now: now.add(const Duration(seconds: 900))), hasLength(1));
  });

  test('stale outbox callbacks cannot match a replacement by timestamp alone', () async {
    final store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    await store.write('pace.profile.name', 'first value');
    final staleOperation = store.pendingOperations().single;

    await store.write('pace.profile.name', 'replacement value');
    final replacement = store.pendingOperations().single;

    // Simulate two writes sharing the same timestamp while carrying different
    // payloads; timestamps are not guaranteed to be unique operation IDs.
    final collidingStaleOperation = <String, dynamic>{
      ...staleOperation,
      'queuedAt': replacement['queuedAt'],
    };
    await store.deferOperation(
      collidingStaleOperation,
      expectedUserId: 'user-a',
      now: DateTime.utc(2026, 10, 17, 10),
    );
    await store.acknowledgeOperation(
      collidingStaleOperation,
      expectedUserId: 'user-a',
    );

    expect(store.read('pace.profile.name'), 'replacement value');
    expect(store.pendingOperations(), hasLength(1));
    expect(store.pendingOperations().single['value'], 'replacement value');
    expect(store.hasDueOperationForKey('pace.profile.name'), isTrue);

    // A legacy/stale callback without queuedAt must not match a replacement
    // merely because the payload is identical.
    final missingTimestampOperation = <String, dynamic>{
      ...replacement,
      'queuedAt': null,
    };
    expect(store.isPendingOperation(missingTimestampOperation), isFalse);
    await store.deferOperation(
      missingTimestampOperation,
      expectedUserId: 'user-a',
      now: DateTime.now().toUtc(),
    );
    await store.acknowledgeOperation(
      missingTimestampOperation,
      expectedUserId: 'user-a',
    );
    expect(store.pendingOperations(), hasLength(1));
    expect(store.pendingOperations().single['value'], 'replacement value');
    expect(store.pendingOperations().single['nextAttemptAt'], isNull);
  });

  test('scoped writes and removes cannot cross an account switch', () async {
    final store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    await store.write('pace.profile.name', 'account A');

    await store.activateAccount('user-b');
    await store.write('pace.profile.name', 'account B');

    // A delayed callback from account A or the guest session is ignored rather
    // than throwing into Flutter's async error handler.
    await store.writeForAccount('user-a', 'pace.profile.name', 'late account A write');
    await store.removeForAccount('user-a', 'pace.profile.name');
    await store.writeForAccount(null, 'pace.profile.name', 'late guest write');

    expect(store.activeUserId, 'user-b');
    expect(store.read('pace.profile.name'), 'account B');
    expect(store.pendingOperations(), hasLength(1));
    expect(store.pendingOperations().single['value'], 'account B');
  });

  test('AI service reads memory while its guest account scope is current', () async {
    final store = await LocalStore.open(directory: directory);
    await store.write('pace.ai.memory', <Map<String, dynamic>>[
      {
        'id': 'guest-memory',
        'text': 'guest memory remains readable',
        'createdAt': '2026-10-17T10:00:00Z',
      },
    ]);
    final ai = PaceAiService(
      localStore: store,
      sync: SyncService(localStore: store, client: null),
      auth: const PaceAuthService(null),
    );

    expect(ai.loadMemory(), hasLength(1));
    expect(ai.loadMemory().single.text, 'guest memory remains readable');
  });

  test('stale AI service cannot read or write the next account state', () async {
    final store = await LocalStore.open(directory: directory);
    // A guest-created AI service can finish an async task after sign-in.
    final ai = PaceAiService(
      localStore: store,
      sync: SyncService(localStore: store, client: null),
      auth: const PaceAuthService(null),
    );

    await store.activateAccount('user-b');
    final accountBMemory = <Map<String, dynamic>>[
      {'id': 'b-memory', 'text': 'account B only', 'createdAt': '2026-10-17T10:00:00Z'},
    ];
    await store.write('pace.ai.memory', accountBMemory);

    expect(ai.loadMemory(), isEmpty);
    await ai.addMemory('late response from the guest session');

    expect(store.read('pace.ai.memory'), accountBMemory);
  });

  test('stale sync completions cannot mutate another account', () async {
    final store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    await store.write('pace.profile.name', 'account A');
    final operationA = store.pendingOperations().single;

    await store.activateAccount('user-b');
    await store.write('pace.profile.name', 'account B');

    await expectLater(
      store.applyRemote(
        'pace.profile.name',
        'stale remote A',
        DateTime.now().toUtc().toIso8601String(),
        expectedUserId: 'user-a',
      ),
      throwsStateError,
    );
    await expectLater(
      store.acknowledgeOperation(operationA, expectedUserId: 'user-a'),
      throwsStateError,
    );
    expect(store.read('pace.profile.name'), 'account B');
    expect(store.pendingOperations(), hasLength(1));
  });

  test('corrupt primary file restores the last known-good backup', () async {
    final primary = File('${directory.path}/pace_local.json');
    final backup = File('${directory.path}/pace_local.json.bak');
    await primary.writeAsString('{corrupt json');
    await backup.writeAsString('{"pace.profile.name":"recovered"}');

    final store = await LocalStore.open(directory: directory);

    expect(store.read('pace.profile.name'), 'recovered');
    expect(await primary.exists(), isTrue);
    final quarantined = directory
        .listSync()
        .whereType<File>()
        .where((file) => file.path.contains('.corrupt-'));
    expect(quarantined, isNotEmpty);
  });

  test('successful flush keeps a durable previous snapshot for recovery', () async {
    final store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    await store.write('pace.profile.name', 'first value');
    await store.write('pace.profile.name', 'second value');

    final primary = File('${directory.path}/pace_local_user-a.json');
    final backup = File('${directory.path}/pace_local_user-a.json.bak');
    expect(await backup.exists(), isTrue);
    expect((await backup.readAsString()).contains('first value'), isTrue);

    await primary.writeAsString('{corrupt json');
    final reopened = await LocalStore.open(directory: directory);
    await reopened.activateAccount('user-a');
    expect(reopened.read('pace.profile.name'), 'first value');
  });

  test('missing primary restores backup without consuming the recovery copy', () async {
    final backup = File('${directory.path}/pace_local.json.bak');
    await backup.writeAsString('{"pace.profile.name":"recovered"}');

    final store = await LocalStore.open(directory: directory);

    expect(store.read('pace.profile.name'), 'recovered');
    expect(await File('${directory.path}/pace_local.json').exists(), isTrue);
    expect(await backup.exists(), isTrue);
  });

  test('sanitized account filenames cannot collide across distinct user IDs', () async {
    var store = await LocalStore.open(directory: directory);
    await store.activateAccount('user/a');
    await store.write('pace.profile.name', 'slash account');
    final slashFile = File('${directory.path}/pace_local_user_a__dXNlci9h.json');
    expect(await slashFile.exists(), isTrue);

    await store.activateAccount('user_a');
    expect(store.read('pace.profile.name'), isNull);
    await store.write('pace.profile.name', 'underscore account');
    final underscoreFile = File('${directory.path}/pace_local_user_a.json');
    expect(await underscoreFile.exists(), isTrue);

    store = await LocalStore.open(directory: directory);
    await store.activateAccount('user/a');
    expect(store.read('pace.profile.name'), 'slash account');
    await store.activateAccount('user_a');
    expect(store.read('pace.profile.name'), 'underscore account');
  });

  test('account data persists independently across store reopen', () async {
    var store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    await store.write('pace.profile.name', 'account A');

    store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    expect(store.read('pace.profile.name'), 'account A');

    await store.activateAccount('user-b');
    expect(store.read('pace.profile.name'), isNull);
  });
}
