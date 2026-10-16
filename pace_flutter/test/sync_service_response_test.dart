import 'package:flutter_test/flutter_test.dart';
import 'package:pace/core/sync/sync_service.dart';

void main() {
  group('SyncService.isUserStateWriteAccepted', () {
    test('accepts the JSON object returned by upsert_user_state_if_newer', () {
      expect(
        SyncService.isUserStateWriteAccepted({
          'accepted': true,
          'updated_at': '2026-10-16T10:00:00Z',
        }),
        isTrue,
      );
    });

    test('does not treat a rejected JSON response as accepted', () {
      expect(
        SyncService.isUserStateWriteAccepted({
          'accepted': false,
          'updated_at': '2026-10-16T10:00:00Z',
        }),
        isFalse,
      );
    });

    test('preserves compatibility with a bare boolean response', () {
      expect(SyncService.isUserStateWriteAccepted(true), isTrue);
      expect(SyncService.isUserStateWriteAccepted(false), isFalse);
    });

    test('fails closed for malformed or missing responses', () {
      expect(SyncService.isUserStateWriteAccepted(null), isFalse);
      expect(SyncService.isUserStateWriteAccepted({'updated_at': 'now'}), isFalse);
      expect(SyncService.isUserStateWriteAccepted('true'), isFalse);
    });
  });
}
