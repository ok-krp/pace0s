import 'package:flutter_test/flutter_test.dart';
import 'package:pace/core/sync/sync_service.dart';

void main() {
  group('Flutter Nutrition IDs', () {
    test('creates valid UUID v4 IDs for canonical food_log rows', () {
      final id = newFoodLogUuid();
      expect(
        RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}
    test('does not sync without an authenticated account', () {
      expect(shouldRunCloudSync(userId: null, consentGranted: true), isFalse);
    });

    test('does not sync when functional cloud consent is disabled', () {
      expect(shouldRunCloudSync(userId: 'user-a', consentGranted: false), isFalse);
    });

    test('allows sync only when the account explicitly granted consent', () {
      expect(shouldRunCloudSync(userId: 'user-a', consentGranted: true), isTrue);
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
, caseSensitive: false).hasMatch(id),
        isTrue,
      );
    });

    test('creates distinct IDs for separate manual meals', () {
      expect(newFoodLogUuid(), isNot(newFoodLogUuid()));
    });
  });

  group('Flutter cross-device sync consent', () {
    test('does not sync without an authenticated account', () {
      expect(shouldRunCloudSync(userId: null, consentGranted: true), isFalse);
    });

    test('does not sync when functional cloud consent is disabled', () {
      expect(shouldRunCloudSync(userId: 'user-a', consentGranted: false), isFalse);
    });

    test('allows sync only when the account explicitly granted consent', () {
      expect(shouldRunCloudSync(userId: 'user-a', consentGranted: true), isTrue);
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
