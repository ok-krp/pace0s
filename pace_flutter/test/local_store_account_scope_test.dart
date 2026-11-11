import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:pace/core/storage/local_store.dart';

void main() {
  group('LocalStore account namespaces', () {
    test('first authenticated account adopts the legacy v1 snapshot intact', () async {
      final directory = await Directory.systemTemp.createTemp('pace-local-v1-');
      addTearDown(() async {
        if (await directory.exists()) {
          await directory.delete(recursive: true);
        }
      });
      final file = File('${directory.path}/pace_local.json');
      final legacyItems = {
        '2026-11-11': [
          {
            'id': '1731340800000000',
            'name': 'Repas manuel historique',
            'meal': 'Déjeuner',
            'kcal': 620,
            'p': 32,
            'c': 74,
            'f': 18,
            'qty': 1,
          }
        ]
      };
      final legacyOutbox = [
        {
          'key': 'pace.nutrition.items',
          'value': legacyItems,
          'operation': 'upsert',
          'queuedAt': '2026-11-11T20:00:00.000Z',
        }
      ];
      await file.writeAsString(jsonEncode({
        'pace.nutrition.items': legacyItems,
        '__outbox': legacyOutbox,
      }));

      final store = await LocalStore.openAt(file);
      expect(store.currentAccountId, isNull);
      expect(store.read('pace.nutrition.items'), legacyItems);
      expect(store.pendingOperations(), hasLength(1));

      // Reproduce real app startup: AuthGate first activates the guest scope
      // while Supabase resolves its initial session, then receives user A.
      await store.activateAccount(null);
      expect(store.currentAccountId, isNull);
      expect(store.read('pace.nutrition.items'), isNull);
      await store.activateAccount('user-a');

      expect(store.currentAccountId, 'user-a');
      expect(store.read('pace.nutrition.items'), legacyItems);
      expect(store.pendingOperations(), hasLength(1));

      await store.activateAccount('user-b');

      expect(store.currentAccountId, 'user-b');
      expect(store.read('pace.nutrition.items'), isNull);
      expect(store.pendingOperations(), isEmpty);
    });

    test('fails closed and preserves an unreadable existing local file', () async {
      final directory = await Directory.systemTemp.createTemp('pace-local-corrupt-');
      addTearDown(() async {
        if (await directory.exists()) {
          await directory.delete(recursive: true);
        }
      });
      final file = File('${directory.path}/pace_local.json');
      const corrupted = '{invalid-json';
      await file.writeAsString(corrupted);

      await expectLater(
        LocalStore.openAt(file),
        throwsA(isA<StateError>()),
      );
      expect(await file.readAsString(), corrupted);
    });

    test('keeps account outboxes isolated when a late acknowledgement arrives', () async {
      final directory = await Directory.systemTemp.createTemp('pace-local-v2-');
      addTearDown(() async {
        if (await directory.exists()) {
          await directory.delete(recursive: true);
        }
      });
      final file = File('${directory.path}/pace_local.json');
      final store = await LocalStore.openAt(file);

      await store.activateAccount('user-a');
      final nutritionA = {
        '2026-11-11': [
          {'id': 'meal-a', 'name': 'Repas A', 'kcal': 500}
        ]
      };
      await store.write('pace.nutrition.items', nutritionA);
      final operationA = store.pendingOperations().single;

      await store.activateAccount('user-b');
      expect(store.read('pace.nutrition.items'), isNull);
      expect(store.pendingOperations(), isEmpty);

      await store.write('pace.settings.theme', 'dark');
      final operationB = store.pendingOperations().single;

      await store.acknowledgeOperationForAccount(
        'user-a',
        operationA,
        '2026-11-11T20:01:00.000Z',
      );

      // The late response for A must update A's saved outbox, not B's active one.
      expect(store.currentAccountId, 'user-b');
      expect(store.read('pace.settings.theme'), 'dark');
      expect(store.pendingOperations(), [operationB]);
      expect(store.lastSyncedAt('pace.settings.theme'), isNull);

      await store.activateAccount('user-a');
      expect(store.read('pace.nutrition.items'), nutritionA);
      expect(store.pendingOperations(), isEmpty);
      expect(
        store.lastSyncedAt('pace.nutrition.items'),
        '2026-11-11T20:01:00.000Z',
      );

      final reopened = await LocalStore.openAt(file);
      expect(reopened.currentAccountId, 'user-a');
      expect(reopened.read('pace.nutrition.items'), nutritionA);
      await reopened.activateAccount('user-b');
      expect(reopened.read('pace.settings.theme'), 'dark');
      expect(reopened.pendingOperations(), [operationB]);
    });
  });
}
