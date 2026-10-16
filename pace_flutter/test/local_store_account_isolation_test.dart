import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:pace/core/storage/local_store.dart';

void main() {
  late Directory directory;

  setUp(() async {
    directory = await Directory.systemTemp.createTemp('pace-local-store-test-');
  });

  tearDown(() async {
    if (await directory.exists()) await directory.delete(recursive: true);
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
    expect(store.pendingOperations(now: now.add(const Duration(seconds: 4))), isEmpty);
    final due = store.pendingOperations(now: now.add(const Duration(seconds: 5)));
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
      final delaySeconds = (5 * (1 << attempt.clamp(0, 8))).clamp(5, 900);
      now = now.add(Duration(seconds: delaySeconds));
      operation = store.pendingOperations(now: now).single;
    }

    final nextAttempt = DateTime.parse(operation['nextAttemptAt'] as String);
    expect(nextAttempt.difference(now), const Duration(seconds: 900));
    expect(store.pendingOperations(now: now.add(const Duration(seconds: 899))), isEmpty);
    expect(store.pendingOperations(now: now.add(const Duration(seconds: 900))), hasLength(1));
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
