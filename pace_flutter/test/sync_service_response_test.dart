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

  group('SyncService.shouldRunFullReconciliation', () {
    final now = DateTime.utc(2026, 10, 16, 12);

    test('runs a full pull when no cursor exists', () {
      expect(
        SyncService.shouldRunFullReconciliation(
          cursorAt: null,
          lastFullPullAt: null,
          now: now,
        ),
        isTrue,
      );
    });

    test('uses a delta pull while the full-reconcile interval is fresh', () {
      expect(
        SyncService.shouldRunFullReconciliation(
          cursorAt: now.subtract(const Duration(minutes: 1)),
          lastFullPullAt: now.subtract(const Duration(minutes: 9)),
          now: now,
        ),
        isFalse,
      );
    });

    test('forces a full pull after ten minutes', () {
      expect(
        SyncService.shouldRunFullReconciliation(
          cursorAt: now.subtract(const Duration(minutes: 11)),
          lastFullPullAt: now.subtract(const Duration(minutes: 10)),
          now: now,
        ),
        isTrue,
      );
    });

    test('forces a full scan when the saved delta cursor is in the future', () {
      expect(
        SyncService.shouldRunFullReconciliation(
          cursorAt: now.add(const Duration(days: 1)),
          lastFullPullAt: now.subtract(const Duration(minutes: 1)),
          now: now,
        ),
        isTrue,
      );
    });

    test('recovers safely if the local clock moves behind the last full pull', () {
      expect(
        SyncService.shouldRunFullReconciliation(
          cursorAt: now,
          lastFullPullAt: now.add(const Duration(minutes: 1)),
          now: now,
        ),
        isTrue,
      );
    });
  });

  group('SyncService.cursorAfterPull', () {
    final now = DateTime.utc(2026, 10, 17, 10);

    test('an empty successful full scan establishes a cursor', () {
      expect(
        SyncService.cursorAfterPull(
          newestSeen: null,
          fullPull: true,
          now: now,
        ),
        now,
      );
    });

    test('a non-empty scan preserves the newest server timestamp', () {
      final newest = now.subtract(const Duration(seconds: 30));
      expect(
        SyncService.cursorAfterPull(
          newestSeen: newest,
          fullPull: true,
          now: now,
        ),
        newest,
      );
    });

    test('an empty delta scan does not invent a cursor', () {
      expect(
        SyncService.cursorAfterPull(
          newestSeen: null,
          fullPull: false,
          now: now,
        ),
        isNull,
      );
    });
  });

  group('SyncService.shouldPropagateAiPreferences', () {
    test('does not bypass backoff while any local preference mutation remains', () {
      expect(
        SyncService.shouldPropagateAiPreferences(
          hadLocalMutation: true,
          hasPendingMutation: true,
        ),
        isFalse,
      );
    });

    test('propagates local preferences after the outbox is acknowledged', () {
      expect(
        SyncService.shouldPropagateAiPreferences(
          hadLocalMutation: true,
          hasPendingMutation: false,
        ),
        isTrue,
      );
    });

    test('does not push preferences when there was no local mutation', () {
      expect(
        SyncService.shouldPropagateAiPreferences(
          hadLocalMutation: false,
          hasPendingMutation: false,
        ),
        isFalse,
      );
    });
  });
}
