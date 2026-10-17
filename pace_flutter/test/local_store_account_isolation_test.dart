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

  test('blocks writes immediately when an account switch is requested', () async {
    final store = await LocalStore.open(directory: directory);
    await store.activateAccount('user-a');
    await store.write('pace.profile.name', 'account A');

    final switching = store.activateAccount('user-b');
    await expectLater(
      store.write('pace.profile.name', 'late write'),
      throwsA(isA<StateError>()),
    );
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
