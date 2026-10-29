import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pace/core/platform/health_adapter.dart';
import 'package:pace/core/storage/local_store.dart';
import 'package:pace/core/sync/sync_service.dart';
import 'package:pace/features/health/health_page.dart';

void main() {
  test('health read scope closes at switch request before active account ID changes', () {
    expect(
      HealthPage.isHealthReadScopeCurrent(
        mounted: true,
        accountSwitching: true,
        currentGeneration: 4,
        expectedGeneration: 4,
        activeUserId: 'user-a',
        expectedUserId: 'user-a',
      ),
      isFalse,
    );
    expect(
      HealthPage.isHealthReadScopeCurrent(
        mounted: true,
        accountSwitching: false,
        currentGeneration: 4,
        expectedGeneration: 4,
        activeUserId: 'user-a',
        expectedUserId: 'user-a',
      ),
      isTrue,
    );
  });

  testWidgets(
    'health page clears prior account samples when the store switches accounts',
    (tester) async {
      final directory = await tester.runAsync(
        () => Directory.systemTemp.createTemp('pace-health-view-scope-'),
      );
      if (directory == null) {
        throw StateError('Could not create test directory');
      }

      final store = await tester.runAsync(
        () => LocalStore.open(directory: directory),
      );
      if (store == null) throw StateError('Could not open local store');

      addTearDown(() async {
        store.dispose();
        await tester.runAsync(() => directory.delete(recursive: true));
      });

      await tester.runAsync(() async {
        await store.activateAccount('user-a');
        await store.write(
          'pace.health.samples',
          [
            {
              'type': 'steps',
              'value': 1234,
              'timestamp': '2026-10-28T10:00:00Z',
              'unit': 'count',
              'source': 'private-source-a',
            },
          ],
          enqueueSync: false,
        );
      });

      await tester.pumpWidget(
        MaterialApp(
          home: HealthPage(
            localStore: store,
            sync: SyncService(localStore: store, client: null),
          ),
        ),
      );
      expect(find.textContaining('private-source-a'), findsOneWidget);

      // Simulate the store being switched while this route is still mounted.
      await tester.runAsync(() => store.activateAccount('user-b'));
      await tester.pump();

      expect(find.textContaining('private-source-a'), findsNothing);
      expect(
        find.text('Aucune donnée accessible sur cette période, ou les permissions n’ont pas été accordées.'),
        findsOneWidget,
      );
    },
    timeout: const Timeout(Duration(seconds: 45)),
  );

  testWidgets(
    'health permission completion from an old account is discarded',
    (tester) async {
      final directory = await tester.runAsync(
        () => Directory.systemTemp.createTemp('pace-health-account-'),
      );
      if (directory == null) {
        throw StateError('Could not create test directory');
      }

      final store = await tester.runAsync(
        () => LocalStore.open(directory: directory),
      );
      if (store == null) throw StateError('Could not open local store');

      addTearDown(() async {
        store.dispose();
        await tester.runAsync(() => directory.delete(recursive: true));
      });

      await tester.runAsync(() => store.activateAccount('user-a'));
      final adapter = _PendingPermissionHealthAdapter();
      await tester.pumpWidget(
        MaterialApp(
          home: HealthPage(
            localStore: store,
            sync: SyncService(localStore: store, client: null),
            adapter: adapter,
          ),
        ),
      );

      await tester.tap(find.text('Autoriser et synchroniser'));
      await tester.pump();
      expect(adapter.permissionRequested, isTrue);

      // A permission prompt may complete after sign-out/sign-in. It must not
      // continue reading or persisting device samples into the next account.
      await tester.runAsync(() => store.activateAccount('user-b'));
      adapter.permissionResult.complete(true);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(adapter.readRecentCalled, isFalse);
      expect(store.activeUserId, 'user-b');
      expect(store.read('pace.health.samples'), isNull);
    },
    timeout: const Timeout(Duration(seconds: 45)),
  );
}

class _PendingPermissionHealthAdapter implements HealthAdapter {
  final Completer<bool> permissionResult = Completer<bool>();
  bool permissionRequested = false;
  bool readRecentCalled = false;

  @override
  Future<bool> isAvailable() async => true;

  @override
  Future<bool> requestPermissions() {
    permissionRequested = true;
    return permissionResult.future;
  }

  @override
  Future<List<PaceHealthSample>> readRecent({
    Duration window = const Duration(days: 7),
  }) async {
    readRecentCalled = true;
    return [
      PaceHealthSample(
        type: 'steps',
        value: 1234,
        timestamp: DateTime.utc(2026, 10, 28, 10),
        unit: 'count',
        source: 'test',
      ),
    ];
  }
}
