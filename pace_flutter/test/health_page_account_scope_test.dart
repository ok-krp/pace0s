import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pace/core/platform/health_adapter.dart';
import 'package:pace/core/storage/local_store.dart';
import 'package:pace/core/sync/sync_service.dart';
import 'package:pace/features/health/health_page.dart';

void main() {
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
