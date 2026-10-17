import 'package:flutter_test/flutter_test.dart';
import 'package:pace/core/sync/sync_service.dart';

void main() {
  group('SyncService.normalizeRemoteKey', () {
    test('maps legacy cloud keys into the canonical Pace namespace', () {
      expect(SyncService.normalizeRemoteKey('lt.profile.name'), 'pace.profile.name');
      expect(SyncService.normalizeRemoteKey('pace.profile.name'), 'pace.profile.name');
      expect(SyncService.normalizeRemoteKey('other.key'), 'other.key');
    });

    test('normalizes legacy active-session keys before applying exclusions', () {
      final normalized = SyncService.normalizeRemoteKey('lt.sport.active');
      expect(normalized, 'pace.sport.active');
      expect(SyncService.isSyncableKey(normalized), isFalse);
    });
  });

  group('SyncService.isSyncableKey', () {
    test('keeps ordinary Pace state syncable', () {
      expect(SyncService.isSyncableKey('pace.settings.theme'), isTrue);
      expect(SyncService.isSyncableKey('pace.sport.sessions'), isTrue);
    });

    test('excludes device-local active sessions to match the web client', () {
      expect(SyncService.isSyncableKey('pace.sport.active'), isFalse);
    });

    test('keeps account-local sync cursors out of the cloud outbox', () {
      expect(SyncService.isSyncableKey('pace.__sync_last_pull_at'), isFalse);
      expect(SyncService.isSyncableKey('pace.__sync_last_full_pull_at'), isFalse);
    });

    test('rejects keys outside the Pace namespace', () {
      expect(SyncService.isSyncableKey('lt.profile.name'), isFalse);
      expect(SyncService.isSyncableKey('__outbox'), isFalse);
    });
  });

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

  group('SyncService.cursorSeedBeforePull', () {
    final now = DateTime.utc(2026, 10, 17, 10);

    test('a full reconciliation does not inherit an old cursor', () {
      expect(
        SyncService.cursorSeedBeforePull(
          cursorAt: now.subtract(const Duration(days: 1)),
          fullPull: true,
          now: now,
        ),
        isNull,
      );
    });

    test('a delta pull preserves a valid existing cursor', () {
      final cursor = now.subtract(const Duration(minutes: 1));
      expect(
        SyncService.cursorSeedBeforePull(
          cursorAt: cursor,
          fullPull: false,
          now: now,
        ),
        cursor,
      );
    });

    test('a future cursor is discarded to force recovery', () {
      expect(
        SyncService.cursorSeedBeforePull(
          cursorAt: now.add(const Duration(minutes: 1)),
          fullPull: false,
          now: now,
        ),
        isNull,
      );
    });
  });

  group('SyncService.cursorAfterPull', () {
    final now = DateTime.utc(2026, 10, 17, 10);

    test('an empty successful full scan establishes an overlapped cursor', () {
      expect(
        SyncService.cursorAfterPull(
          newestSeen: null,
          previousCursorAt: null,
          fullPull: true,
          now: now,
        ),
        now.subtract(SyncService.cursorOverlapWindow),
      );
    });

    test('an empty full scan does not move a recent valid cursor backward', () {
      final previous = now.subtract(const Duration(seconds: 30));
      expect(
        SyncService.cursorAfterPull(
          newestSeen: null,
          previousCursorAt: previous,
          fullPull: true,
          now: now,
        ),
        previous,
      );
    });

    test('an empty full scan discards a future cursor', () {
      expect(
        SyncService.cursorAfterPull(
          newestSeen: null,
          previousCursorAt: now.add(const Duration(minutes: 5)),
          fullPull: true,
          now: now,
        ),
        now.subtract(SyncService.cursorOverlapWindow),
      );
    });

    test('a non-empty scan preserves the newest server timestamp', () {
      final newest = now.subtract(const Duration(seconds: 30));
      expect(
        SyncService.cursorAfterPull(
          newestSeen: newest,
          previousCursorAt: null,
          fullPull: true,
          now: now,
        ),
        newest,
      );
    });

    test('a future row timestamp is clamped to scan time', () {
      expect(
        SyncService.cursorAfterPull(
          newestSeen: now.add(const Duration(minutes: 5)),
          previousCursorAt: null,
          fullPull: false,
          now: now,
        ),
        now,
      );
    });

    test('a full scan with only older rows never moves a valid cursor backward', () {
      final previous = now.subtract(const Duration(minutes: 2));
      final newest = now.subtract(const Duration(minutes: 5));
      expect(
        SyncService.cursorAfterPull(
          newestSeen: newest,
          previousCursorAt: previous,
          fullPull: true,
          now: now,
        ),
        previous,
      );
    });

    test('an empty delta scan does not invent a cursor', () {
      expect(
        SyncService.cursorAfterPull(
          newestSeen: null,
          previousCursorAt: null,
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
