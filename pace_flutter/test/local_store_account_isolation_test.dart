import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import '../lib/core/storage/local_store.dart';

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
