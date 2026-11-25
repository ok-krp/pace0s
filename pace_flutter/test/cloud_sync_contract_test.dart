import 'package:flutter_test/flutter_test.dart';
import 'package:pace/core/sync/sync_service.dart';

void main() {
  group('Native Nutrition projection concurrency', () {
    test('preserves local rows created while food_log was being queried', () {
      final newPendingId = newFoodLogUuid();
      final result = mergeNutritionProjectionRows(
        canonicalRows: [
          {
            'id': newFoodLogUuid(),
            'name': 'Repas cloud',
            'meal': 'Déjeuner',
            'kcal': 400,
          },
        ],
        latestLocalRows: [
          {
            'id': '1731340800000000',
            'name': 'Ancien repas Flutter',
            'meal': 'Dîner',
            'kcal': 600,
          },
          {
            'id': newPendingId,
            'name': 'Ajout pendant la requête',
            'meal': 'Goûter',
            'kcal': 250,
            'pendingFoodLog': true,
          },
          {
            'id': newFoodLogUuid(),
            'name': 'Repas supprimé',
            'meal': 'Petit-déjeuner',
            'kcal': 200,
          },
        ],
      );

      expect(result.map((item) => item['name']), contains('Repas cloud'));
      expect(result.map((item) => item['name']), contains('Ancien repas Flutter'));
      expect(result.map((item) => item['name']), contains('Ajout pendant la requête'));
      expect(result.map((item) => item['name']), isNot(contains('Repas supprimé')));
    });

    test('does not duplicate a pending row already returned by food_log', () {
      final id = newFoodLogUuid();
      final result = mergeNutritionProjectionRows(
        canonicalRows: [
          {'id': id, 'name': 'Repas synchronisé', 'kcal': 350},
        ],
        latestLocalRows: [
          {'id': id, 'name': 'Repas local en attente', 'kcal': 350, 'pendingFoodLog': true},
        ],
      );

      expect(result, hasLength(1));
      expect(result.single['id'], id);
    });

    test('filters deleted canonical, legacy and pending meal IDs from projection', () {
      const deletedCanonical = 'b3d2d75a-5e4c-4f08-9d7b-5f3aa34a3be1';
      const deletedPending = '2f6b44af-0d6c-45e1-a760-c9b559c8e992';
      final result = mergeNutritionProjectionRows(
        canonicalRows: [
          {'id': deletedCanonical, 'name': 'Ancien repas cloud'},
          {'id': '2c99003e-d73f-4e52-91b0-bd44de2f8680', 'name': 'Repas conservé'},
        ],
        latestLocalRows: [
          {'id': 'legacy-meal-deleted', 'name': 'Ancien repas local'},
          {'id': 'legacy-meal-kept', 'name': 'Ancien repas conservé'},
          {'id': deletedPending, 'name': 'Ajout local supprimé', 'pendingFoodLog': true},
        ],
        deletedIds: {deletedCanonical, deletedPending, 'legacy-meal-deleted'},
      );

      expect(result.map((item) => item['name']), contains('Repas conservé'));
      expect(result.map((item) => item['name']), contains('Ancien repas conservé'));
      expect(result.map((item) => item['name']), isNot(contains('Ancien repas cloud')));
      expect(result.map((item) => item['name']), isNot(contains('Ancien repas local')));
      expect(result.map((item) => item['name']), isNot(contains('Ajout local supprimé')));
    });

    test('filters deleted IDs across all days of a remote Nutrition snapshot', () {
      final value = {
        '2026-11-18': [
          {'id': 'deleted-one', 'name': 'Repas supprimé'},
          {'id': 'kept-one', 'name': 'Repas conservé'},
        ],
        '2026-11-19': [
          {'id': 'deleted-two', 'name': 'Ancien repas supprimé'},
          {'id': 'kept-two', 'name': 'Nouveau repas conservé'},
        ],
      };

      final result = filterDeletedNutritionItems(
        value,
        {'deleted-one', 'deleted-two'},
      ) as Map<String, dynamic>;

      expect((result['2026-11-18'] as List).map((item) => item['name']),
          ['Repas conservé']);
      expect((result['2026-11-19'] as List).map((item) => item['name']),
          ['Nouveau repas conservé']);
    });
  });

  group('Flutter Nutrition IDs', () {
    test('creates valid UUID v4 IDs for canonical food_log rows', () {
      final id = newFoodLogUuid();
      final uuidV4 = RegExp(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
        caseSensitive: false,
      );
      expect(uuidV4.hasMatch(id), isTrue);
    });

    test('creates distinct IDs for separate manual meals', () {
      expect(newFoodLogUuid(), isNot(newFoodLogUuid()));
    });
  });

  group('Flutter device-local sync exclusions', () {
    test('keeps wallpapers, finance PINs and device-only records out of user_state', () {
      for (final key in [
        'pace.wallpaper',
        'lt.wallpaper',
        'pace.finance.pin.hash',
        'pace.privacy.pin.hash',
        'pace.ble.devices',
        'pace.ai.conversations',
        'pace.ai.deleted_conversations',
        'pace.sport.active',
        'pace.__sync_food_log_outbox',
        'pace.__sync_food_log_deleted_ids',
        'pace.__internal_device_key',
        'pace.finance.unlocked',
        'pace.ai.local.enabled',
        'pace.legal.consent',
      ]) {
        expect(SyncService.isSyncableKey(key), isFalse, reason: key);
      }
      expect(SyncService.isSyncableKey('pace.notes'), isTrue);
      expect(SyncService.isSyncableKey('pace.nutrition.items'), isTrue);
    });

    test('filters canonical and legacy device-local aliases before a remote pull', () {
      expect(SyncService.excludedRemotePullKeys, contains('pace.wallpaper'));
      expect(SyncService.excludedRemotePullKeys, contains('lt.wallpaper'));
      expect(SyncService.excludedRemotePullKeys, contains('pace.domain.outbox'));
      expect(SyncService.excludedRemotePullKeys, contains('lt.domain.outbox'));
      expect(SyncService.excludedRemotePullKeys, contains('pace.domain.legal.consent'));
      expect(SyncService.excludedRemotePullKeys, contains('lt.domain.legal.consent'));
      expect(SyncService.excludedRemotePullKeysFilter, contains('"pace.wallpaper"'));
      expect(SyncService.excludedRemotePullKeysFilter, contains('"lt.wallpaper"'));
      expect(SyncService.excludedRemotePullKeysFilter, contains('"pace.domain.outbox"'));
      expect(SyncService.excludedRemotePullKeyPatterns, hasLength(10));
      for (final pattern in [
        r'^(pace|lt)\.__',
        r'^(pace|lt)\.domain\.__',
        r'^(pace|lt)\.ai\.debug',
        r'^(pace|lt)\.domain\.ai\.debug',
        r'^(pace|lt)\.ai\.pending:',
        r'^(pace|lt)\.domain\.ai\.pending:',
      ]) {
        expect(SyncService.excludedRemotePullKeyPatterns, contains(pattern));
      }
      expect(
        SyncService.excludedRemotePullKeyPatterns.any(
          (pattern) => pattern.contains('(finance|ai'),
        ),
        isTrue,
      );
      expect(
        SyncService.excludedRemotePullKeyPatterns.any(
          (pattern) => pattern.contains(r'\.__'),
        ),
        isTrue,
      );
      for (final key in [
        'pace.domain.outbox',
        'lt.domain.outbox',
        'pace.domain.ble.mapping',
        'pace.domain.import.log',
        'pace.domain.legal.consent',
        'lt.domain.legal.consent',
        'pace.domain.dark',
        'pace.domain.__sync_meta',
        'pace.domain.ai.debug.trace',
        'lt.domain.ai.debug.trace',
        'pace.ai.debug.trace',
      ]) {
        expect(SyncService.isDeviceLocalKey(key), isTrue, reason: key);
      }
    });
  });

  group('Flutter cross-device sync consent', () {
    test('does not sync without an authenticated account', () {
      expect(shouldRunCloudSync(userId: null, activeAccountId: null, consentGranted: true), isFalse);
    });

    test('does not sync when functional cloud consent is disabled', () {
      expect(shouldRunCloudSync(userId: 'user-a', activeAccountId: 'user-a', consentGranted: false), isFalse);
    });

    test('allows sync only when the account explicitly granted consent', () {
      expect(shouldRunCloudSync(userId: 'user-a', activeAccountId: 'user-a', consentGranted: true), isTrue);
    });
    
    test('never syncs one account using another account local snapshot', () {
      expect(
        shouldRunCloudSync(
          userId: 'user-b',
          activeAccountId: 'user-a',
          consentGranted: true,
        ),
        isFalse,
      );
    });
  });

  group('Flutter cloud outbox acknowledgement', () {
    test('does not acknowledge a rejected server mutation', () {
      expect(shouldAcknowledgeSyncOperation(accepted: false), isFalse);
    });

    test('acknowledges only a server-accepted mutation', () {
      expect(shouldAcknowledgeSyncOperation(accepted: true), isTrue);
    });
  });

  group('CloudSyncWriteResponse', () {
    test('accepts the ordered RPC response contract', () {
      final result = CloudSyncWriteResponse.fromRpc({
        'accepted': true,
        'updated_at': '2026-09-30T07:30:00.123456+00:00',
      });

      expect(result.accepted, isTrue);
      expect(result.updatedAt, '2026-09-30T07:30:00.123456+00:00');
    });

    test('accepts a rejected write with the authoritative server timestamp', () {
      final result = CloudSyncWriteResponse.fromRpc({
        'accepted': false,
        'updated_at': '2026-09-30T07:31:00+00:00',
      });

      expect(result.accepted, isFalse);
      expect(result.updatedAt, '2026-09-30T07:31:00+00:00');
    });

    test('rejects the old boolean response shape', () {
      expect(
        () => CloudSyncWriteResponse.fromRpc(true),
        throwsA(isA<FormatException>()),
      );
    });

    test('rejects malformed ordered responses', () {
      expect(
        () => CloudSyncWriteResponse.fromRpc({'accepted': true}),
        throwsA(isA<FormatException>()),
      );
      expect(
        () => CloudSyncWriteResponse.fromRpc({
          'accepted': 'true',
          'updated_at': '2026-09-30T07:30:00+00:00',
        }),
        throwsA(isA<FormatException>()),
      );
    });
  });

  group('Flutter user_state Realtime ordering', () {
    final local = DateTime.parse('2026-09-30T07:30:00Z');
    final newer = DateTime.parse('2026-09-30T07:31:00Z');
    final older = DateTime.parse('2026-09-30T07:29:00Z');

    test('applies a newer remote row when there is no local mutation', () {
      expect(
        shouldApplyRealtimeUserState(
          remoteTime: newer,
          localTime: local,
          hasPendingMutation: false,
        ),
        isTrue,
      );
    });

    test('ignores stale Realtime rows', () {
      expect(
        shouldApplyRealtimeUserState(
          remoteTime: older,
          localTime: local,
          hasPendingMutation: false,
        ),
        isFalse,
      );
    });

    test('ignores an event equal to the local checkpoint', () {
      expect(
        shouldApplyRealtimeUserState(
          remoteTime: local,
          localTime: local,
          hasPendingMutation: false,
        ),
        isFalse,
      );
    });

    test('does not let Realtime overwrite a pending local mutation', () {
      expect(
        shouldApplyRealtimeUserState(
          remoteTime: newer,
          localTime: local,
          hasPendingMutation: true,
        ),
        isFalse,
      );
    });

    test('applies a remote row when no local checkpoint exists', () {
      expect(
        shouldApplyRealtimeUserState(
          remoteTime: newer,
          localTime: null,
          hasPendingMutation: false,
        ),
        isTrue,
      );
    });

    test('ignores malformed timestamps', () {
      expect(
        shouldApplyRealtimeUserState(
          remoteTime: null,
          localTime: local,
          hasPendingMutation: false,
        ),
        isFalse,
      );
    });
  });
}
