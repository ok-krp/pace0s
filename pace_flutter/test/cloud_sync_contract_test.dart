import 'package:flutter_test/flutter_test.dart';
import 'package:pace/core/sync/sync_service.dart';

void main() {
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
