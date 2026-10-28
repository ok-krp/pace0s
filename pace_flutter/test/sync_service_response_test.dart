import 'package:flutter_test/flutter_test.dart';
import 'package:pace/core/sync/sync_service.dart';

void main() {
  test('sync scope closes immediately when an account switch is requested', () {
    expect(
      SyncService.isSyncScopeCurrent(
        accountSwitching: true,
        authenticatedUserId: 'user-a',
        activeUserId: 'user-a',
        expectedUserId: 'user-a',
      ),
      isFalse,
    );
    expect(
      SyncService.isSyncScopeCurrent(
        accountSwitching: false,
        authenticatedUserId: 'user-a',
        activeUserId: 'user-a',
        expectedUserId: 'user-a',
      ),
      isTrue,
    );
    expect(
      SyncService.isSyncScopeCurrent(
        accountSwitching: false,
        authenticatedUserId: 'user-b',
        activeUserId: 'user-a',
        expectedUserId: 'user-a',
      ),
      isFalse,
    );
    expect(
      SyncService.isSyncScopeCurrent(
        accountSwitching: false,
        authenticatedUserId: 'user-a',
        activeUserId: 'user-b',
        expectedUserId: 'user-a',
      ),
      isFalse,
    );
  });

  group('SyncService.shouldApplyRemoteValue', () {
    final older = DateTime.utc(2026, 10, 16, 10);
    final newer = DateTime.utc(2026, 10, 17, 10);

    test('recovers non-empty legacy cloud data when local state is empty', () {
      expect(
        SyncService.shouldApplyRemoteValue(
          isLegacy: true,
          localValue: <dynamic>[],
          remoteValue: ['legacy item'],
          localUpdatedAt: newer,
          remoteUpdatedAt: older,
        ),
        isTrue,
      );
    });

    test('keeps canonical cloud values ahead of equal-time legacy aliases', () {
      final timestamp = DateTime.utc(2026, 10, 17, 10);
      // The pull query sorts keys descending after updated_at, so pace.* is
      // applied before lt.* when both aliases have the same server timestamp.
      expect(
        SyncService.shouldApplyRemoteValue(
          isLegacy: false,
          localValue: null,
          remoteValue: 'canonical value',
          localUpdatedAt: null,
          remoteUpdatedAt: timestamp,
        ),
        isTrue,
      );
      expect(
        SyncService.shouldApplyRemoteValue(
          isLegacy: true,
          localValue: 'canonical value',
          remoteValue: 'legacy value',
          localUpdatedAt: timestamp,
          remoteUpdatedAt: timestamp,
        ),
        isFalse,
      );
    });

    test('does not overwrite non-empty local state with older legacy data', () {
      expect(
        SyncService.shouldApplyRemoteValue(
          isLegacy: true,
          localValue: ['current item'],
          remoteValue: ['legacy item'],
          localUpdatedAt: newer,
          remoteUpdatedAt: older,
        ),
        isFalse,
      );
    });

    test('applies a newer canonical cloud value', () {
      expect(
        SyncService.shouldApplyRemoteValue(
          isLegacy: false,
          localValue: 'local',
          remoteValue: 'remote',
          localUpdatedAt: older,
          remoteUpdatedAt: newer,
        ),
        isTrue,
      );
    });
  });

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

    test('keeps all account-local sync metadata out of the cloud outbox', () {
      expect(SyncService.isSyncableKey('pace.__sync_last_pull_at'), isFalse);
      expect(SyncService.isSyncableKey('pace.__sync_last_full_pull_at'), isFalse);
      expect(SyncService.isSyncableKey('pace.__sync_future_cursor'), isFalse);
    });

    test('rejects keys outside the Pace namespace', () {
      expect(SyncService.isSyncableKey('lt.profile.name'), isFalse);
      expect(SyncService.isSyncableKey('__outbox'), isFalse);
    });
  });

  group('SyncService.normalizedOutboxTimestamp', () {
    test('normalizes offset timestamps to UTC before remote writes', () {
      expect(
        SyncService.normalizedOutboxTimestamp(
          '2026-10-18T12:00:00+02:00',
          fallbackNow: DateTime.utc(2026, 10, 18),
        ),
        '2026-10-18T10:00:00.000Z',
      );
    });

    test('uses the fallback for overflowing calendar timestamps', () {
      expect(
        SyncService.normalizedOutboxTimestamp(
          '2026-13-01T10:00:00Z',
          fallbackNow: DateTime.utc(2026, 10, 18),
        ),
        '2026-10-18T00:00:00.000Z',
      );
    });

    test('uses the supplied fallback for malformed timestamps', () {
      expect(
        SyncService.normalizedOutboxTimestamp(
          'invalid',
          fallbackNow: DateTime.utc(2026, 10, 18),
        ),
        '2026-10-18T00:00:00.000Z',
      );
    });
  });

  group('SyncService.isValidOutboxOperation', () {
    test('accepts a valid upsert and delete operation', () {
      expect(
        SyncService.isValidOutboxOperation({
          'key': 'pace.profile.name',
          'queuedAt': '2026-10-18T10:00:00Z',
          'operation': 'upsert',
          'value': 'Pace',
        }),
        isTrue,
      );
      expect(
        SyncService.isValidOutboxOperation({
          'key': 'pace.profile.name',
          'queuedAt': '2026-10-18T10:00:00Z',
          'operation': 'delete',
        }),
        isTrue,
      );
      expect(
        SyncService.isValidOutboxOperation({
          'key': 'pace.profile.name',
          'queuedAt': '2026-10-18T10:00:00Z',
          'operation': 'upsert',
          'value': null,
        }),
        isTrue,
      );
    });

    test('rejects missing keys, malformed timestamps, and unknown operation kinds', () {
      expect(
        SyncService.isValidOutboxOperation({
          'queuedAt': '2026-10-18T10:00:00Z',
          'operation': 'upsert',
        }),
        isFalse,
      );
      expect(
        SyncService.isValidOutboxOperation({
          'key': 'pace.profile.name',
          'queuedAt': 'not-a-timestamp',
          'operation': 'upsert',
        }),
        isFalse,
      );
      expect(
        SyncService.isValidOutboxOperation({
          'key': 'pace.profile.name',
          'queuedAt': '2026-10-18',
          'operation': 'upsert',
          'value': 'preserve local data',
        }),
        isFalse,
      );
      expect(
        SyncService.isValidOutboxOperation({
          'key': 'pace.profile.name',
          'queuedAt': '2026-10-18T10:00:00Z',
          'operation': 'upsert',
        }),
        isFalse,
      );
      expect(
        SyncService.isValidOutboxOperation({
          'key': 'pace.profile.name',
          'queuedAt': '2026-10-18T10:00:00Z',
          'operation': 'unknown',
        }),
        isFalse,
      );
    });
  });

  group('SyncService.userStateWriteUpdatedAt', () {
    test('uses the database timestamp from an accepted RPC response', () {
      expect(
        SyncService.userStateWriteUpdatedAt(
          {
            'accepted': true,
            'updated_at': '2026-10-17T17:00:00.123456+00:00',
          },
          fallback: '2026-10-17T16:59:59.999999Z',
        ),
        '2026-10-17T17:00:00.123456Z',
      );
    });

    test('falls back for older boolean RPC responses', () {
      const fallback = '2026-10-17T17:00:00Z';
      expect(
        SyncService.userStateWriteUpdatedAt(true, fallback: fallback),
        fallback,
      );
    });

    test('falls back when the response timestamp has overflowing components', () {
      expect(
        SyncService.userStateWriteUpdatedAt(
          {'accepted': true, 'updated_at': '2026-13-01T10:00:00Z'},
          fallback: '2026-10-17T17:00:00Z',
        ),
        '2026-10-17T17:00:00Z',
      );
    });

    test('falls back when the response timestamp is malformed', () {
      const fallback = '2026-10-17T17:00:00Z';
      expect(
        SyncService.userStateWriteUpdatedAt(
          {'accepted': true, 'updated_at': 'not-a-timestamp'},
          fallback: fallback,
        ),
        fallback,
      );
    });
  });

  group('SyncService.isUserStateWriteAccepted', () {
    test('accepts structured RPC responses with acceptance and timestamp', () {
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

    test('rejects overflowing calendar timestamps in structured responses', () {
      expect(
        SyncService.isUserStateWriteAccepted({
          'accepted': true,
          'updated_at': '2026-13-01T10:00:00Z',
        }),
        isFalse,
      );
    });

    test('rejects zone-less remote timestamps', () {
      expect(
        SyncService.isUserStateWriteAccepted({
          'accepted': true,
          'updated_at': '2026-10-16T10:00:00',
        }),
        isFalse,
      );
    });

    test('fails closed for malformed or incomplete responses', () {
      expect(SyncService.isUserStateWriteAccepted(null), isFalse);
      expect(SyncService.isUserStateWriteAccepted({'updated_at': 'now'}), isFalse);
      expect(
        SyncService.isUserStateWriteAccepted({'accepted': true}),
        isFalse,
      );
      expect(
        SyncService.isUserStateWriteAccepted({
          'accepted': true,
          'updated_at': 'not-a-timestamp',
        }),
        isFalse,
      );
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

    test('a full scan with only old rows advances to the overlap checkpoint', () {
      final oldRow = now.subtract(const Duration(days: 30));
      final overlap = now.subtract(SyncService.cursorOverlapWindow);
      expect(
        SyncService.cursorAfterPull(
          newestSeen: oldRow,
          previousCursorAt: null,
          fullPull: true,
          now: now,
        ),
        overlap,
      );
      expect(
        SyncService.cursorAfterPull(
          newestSeen: oldRow,
          previousCursorAt: now.subtract(const Duration(minutes: 20)),
          fullPull: true,
          now: now,
        ),
        overlap,
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

      final recentPrevious = now.subtract(const Duration(seconds: 30));
      expect(
        SyncService.cursorAfterPull(
          newestSeen: newest,
          previousCursorAt: recentPrevious,
          fullPull: true,
          now: now,
        ),
        recentPrevious,
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

    test('a stalled delta cursor advances with a bounded overlap', () {
      final previous = now.subtract(const Duration(minutes: 10));
      expect(
        SyncService.cursorAfterPull(
          newestSeen: previous,
          previousCursorAt: previous,
          fullPull: false,
          now: now,
        ),
        now.subtract(SyncService.cursorOverlapWindow),
      );
    });

    test('a recent stalled delta cursor is not moved forward past the overlap', () {
      final previous = now.subtract(const Duration(seconds: 30));
      expect(
        SyncService.cursorAfterPull(
          newestSeen: previous,
          previousCursorAt: previous,
          fullPull: false,
          now: now,
        ),
        previous,
      );
    });
  });

  group('SyncService.buildAiPreferencesPatch', () {
    test('updates confirm_actions without overwriting memory_level', () {
      expect(
        SyncService.buildAiPreferencesPatch(
          userId: 'user-a',
          localConfirm: false,
          localMemory: true,
          pushConfirm: true,
          pushMemory: false,
        ),
        {'user_id': 'user-a', 'confirm_actions': false},
      );
    });

    test('updates memory_level without overwriting confirm_actions', () {
      expect(
        SyncService.buildAiPreferencesPatch(
          userId: 'user-a',
          localConfirm: true,
          localMemory: false,
          pushConfirm: false,
          pushMemory: true,
        ),
        {'user_id': 'user-a', 'memory_level': 'none'},
      );
    });

    test('does not invent values for invalid local preferences', () {
      expect(
        SyncService.buildAiPreferencesPatch(
          userId: 'user-a',
          localConfirm: 'yes',
          localMemory: 1,
          pushConfirm: true,
          pushMemory: true,
        ),
        {'user_id': 'user-a'},
      );
    });
  });

  group('SyncService.aiMemoryEnabledFromLevel', () {
    test('maps every supported database enum value explicitly', () {
      expect(SyncService.aiMemoryEnabledFromLevel('none'), isFalse);
      expect(SyncService.aiMemoryEnabledFromLevel('limited'), isTrue);
      expect(SyncService.aiMemoryEnabledFromLevel('complete'), isTrue);
    });

    test('ignores unknown, null, and non-string values', () {
      expect(SyncService.aiMemoryEnabledFromLevel('enabled'), isNull);
      expect(SyncService.aiMemoryEnabledFromLevel(''), isNull);
      expect(SyncService.aiMemoryEnabledFromLevel(null), isNull);
      expect(SyncService.aiMemoryEnabledFromLevel(1), isNull);
    });
  });

  group('SyncService AI preference retry markers', () {
    test('keeps only supported pending flags from local JSON', () {
      expect(
        SyncService.aiPreferencesPendingFrom({
          'confirm_actions': true,
          'memory': false,
          'unknown': true,
        }),
        {'confirm_actions': true},
      );
      expect(SyncService.aiPreferencesPendingFrom(null), isEmpty);
      expect(SyncService.aiPreferencesPendingFrom('invalid'), isEmpty);
    });

    test('does not apply a remote preference over a newly pending local edit', () {
      expect(
        SyncService.shouldApplyRemoteAiPreference(
          key: 'pace.settings.ai.confirm_actions',
          rawPending: <String, bool>{},
          hasPendingMutation: true,
        ),
        isFalse,
      );
      expect(
        SyncService.shouldApplyRemoteAiPreference(
          key: 'pace.settings.ai.memory',
          rawPending: {'memory': true},
          hasPendingMutation: false,
        ),
        isFalse,
      );
      expect(
        SyncService.shouldApplyRemoteAiPreference(
          key: 'pace.settings.ai.memory',
          rawPending: <String, bool>{},
          hasPendingMutation: false,
        ),
        isTrue,
      );
    });

    test('protects a preference from pulls while its dedicated write retries', () {
      expect(
        SyncService.isAiPreferenceProtectedByRetryMarker(
          'pace.settings.ai.confirm_actions',
          {'confirm_actions': true},
        ),
        isTrue,
      );
      expect(
        SyncService.isAiPreferenceProtectedByRetryMarker(
          'pace.settings.ai.memory',
          {'memory': true},
        ),
        isTrue,
      );
      expect(
        SyncService.isAiPreferenceProtectedByRetryMarker(
          'pace.settings.ai.memory',
          {'confirm_actions': true},
        ),
        isFalse,
      );
      expect(
        SyncService.isAiPreferenceProtectedByRetryMarker(
          'pace.settings.theme',
          {'confirm_actions': true, 'memory': true},
        ),
        isFalse,
      );
    });

    test('clears one successful preference without losing the other retry', () {
      expect(
        SyncService.updateAiPreferencesPending(
          {'confirm_actions': true, 'memory': true},
          confirmActions: false,
        ),
        {'memory': true},
      );
      expect(
        SyncService.updateAiPreferencesPending(
          {'confirm_actions': true, 'memory': true},
          memory: false,
        ),
        {'confirm_actions': true},
      );
    });

    test('clears an unpushable marker only when no newer edit is pending', () {
      expect(
        SyncService.shouldClearUnpushableAiPreferenceMarker(
          pushRequested: true,
          localValueValid: false,
          hasPendingMutation: false,
        ),
        isTrue,
      );
      expect(
        SyncService.shouldClearUnpushableAiPreferenceMarker(
          pushRequested: true,
          localValueValid: false,
          hasPendingMutation: true,
        ),
        isFalse,
      );
      expect(
        SyncService.shouldClearUnpushableAiPreferenceMarker(
          pushRequested: true,
          localValueValid: true,
          hasPendingMutation: false,
        ),
        isFalse,
      );
      expect(
        SyncService.shouldClearUnpushableAiPreferenceMarker(
          pushRequested: false,
          localValueValid: false,
          hasPendingMutation: false,
        ),
        isFalse,
      );
    });

    test('does not clear a retry marker while a newer local edit is pending', () {
      expect(
        SyncService.shouldClearAiPreferenceRetryMarker(
          hasPendingMutation: true,
        ),
        isFalse,
      );
      expect(
        SyncService.shouldClearAiPreferenceRetryMarker(
          hasPendingMutation: false,
        ),
        isTrue,
      );
    });

    test('clears only the conflicted preference retry after remote wins', () {
      expect(
        SyncService.clearAiPreferenceRetryAfterRemoteWinner(
          'pace.settings.ai.memory',
          {'confirm_actions': true, 'memory': true},
        ),
        {'confirm_actions': true},
      );
      expect(
        SyncService.clearAiPreferenceRetryAfterRemoteWinner(
          'pace.settings.ai.confirm_actions',
          {'confirm_actions': true, 'memory': true},
        ),
        {'memory': true},
      );
      expect(
        SyncService.clearAiPreferenceRetryAfterRemoteWinner(
          'pace.settings.theme',
          {'confirm_actions': true, 'memory': true},
        ),
        {'confirm_actions': true, 'memory': true},
      );
    });

    test('adds a retry marker while preserving an existing pending preference', () {
      expect(
        SyncService.updateAiPreferencesPending(
          {'memory': true},
          confirmActions: true,
        ),
        {'confirm_actions': true, 'memory': true},
      );
    });
  });

  group('SyncService.shouldPropagateAiPreferences', () {
    test('does not bypass backoff while any local preference mutation remains', () {
      expect(
        SyncService.shouldPropagateAiPreferences(
          hasRetryMarker: true,
          hasPendingMutation: true,
        ),
        isFalse,
      );
    });

    test('propagates local preferences after the outbox is acknowledged', () {
      expect(
        SyncService.shouldPropagateAiPreferences(
          hasRetryMarker: true,
          hasPendingMutation: false,
        ),
        isTrue,
      );
    });

    test('does not push preferences when there was no local mutation', () {
      expect(
        SyncService.shouldPropagateAiPreferences(
          hasRetryMarker: false,
          hasPendingMutation: false,
        ),
        isFalse,
      );
    });
  });
}
