import 'dart:async';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../storage/local_store.dart';

/// Replays local mutations through Pace's existing user_state RPC and pulls
/// newer remote state. Local writes remain durable while offline.
class SyncService {
  SyncService({required this.localStore, required this.client});

  final LocalStore localStore;
  final SupabaseClient? client;
  bool _running = false;
  bool _rerunRequested = false;

  bool _isCurrentAccount(String expectedUserId) =>
      client?.auth.currentUser?.id == expectedUserId &&
      localStore.activeUserId == expectedUserId;

  /// Supports the boolean return type in the checked-in SQL migration and
  /// structured responses from compatible deployments that include metadata.
  static bool isUserStateWriteAccepted(dynamic response) {
    // The checked-in RPC returns bool; newer deployments may return an object
    // containing acceptance and the database timestamp. Reject partial objects.
    if (response == true) return true;
    if (response is! Map || response['accepted'] != true) return false;
    final updatedAt = response['updated_at'];
    return updatedAt is String && LocalStore.isValidIsoTimestamp(updatedAt);
  }

  /// Prefer a database-authoritative updated_at when a structured RPC
  /// response provides one. The checked-in boolean RPC writes p_updated_at
  /// directly, so its fallback is the exact timestamp sent to PostgreSQL.
  static String userStateWriteUpdatedAt(
    dynamic response, {
    required String fallback,
  }) {
    if (response is Map) {
      final raw = response['updated_at'];
      if (raw is String && LocalStore.isValidIsoTimestamp(raw)) {
        final parsed = DateTime.parse(raw);
        return parsed.toUtc().toIso8601String();
      }
    }
    // Older compatible RPCs may return a bare boolean; retain their existing
    // fallback behavior instead of making a successful write fail locally.
    return fallback;
  }

  /// Keys that are intentionally device-local in the web sync contract.
  /// Keep native push and pull behavior aligned with src/hooks/use-cloud-sync-engine.tsx.
  static const Set<String> excludedSyncKeys = {'pace.sport.active'};

  static bool isSyncableKey(String key) =>
      key.startsWith('pace.') &&
      !key.startsWith('pace.__sync_') &&
      !excludedSyncKeys.contains(key);

  /// Reject malformed persisted operations before any network request. Such
  /// entries are quarantined locally so one poison record cannot retry forever.
  static bool isValidOutboxOperation(Map<String, dynamic> operation) =>
      LocalStore.isValidOutboxOperation(operation);

  /// Normalize queued timestamps to UTC before sending them to PostgreSQL.
  /// Older local files may contain a local timestamp without an explicit zone;
  /// sending that raw string would make its meaning depend on the DB session TZ.
  static String normalizedOutboxTimestamp(
    dynamic queuedAt, {
    required DateTime fallbackNow,
  }) {
    final parsed = queuedAt is String && LocalStore.isValidIsoTimestamp(queuedAt)
        ? DateTime.tryParse(queuedAt)
        : null;
    return (parsed ?? fallbackNow).toUtc().toIso8601String();
  }

  /// Maps legacy cloud keys to the canonical Pace namespace, matching the web
  /// sync engine. This does not import the unscoped legacy local file.
  static String normalizeRemoteKey(String key) =>
      key.startsWith('lt.') ? 'pace.${key.substring(3)}' : key;

  static bool isEmptyValue(dynamic value) {
    if (value == null || value == '') return true;
    if (value is List) return value.isEmpty;
    if (value is Map) return value.isEmpty;
    return false;
  }

  /// Mirrors the web client's legacy recovery rule while retaining the native
  /// requirement that remote timestamps must be valid before applying a row.
  static bool shouldApplyRemoteValue({
    required bool isLegacy,
    required dynamic localValue,
    required dynamic remoteValue,
    required DateTime? localUpdatedAt,
    required DateTime remoteUpdatedAt,
  }) {
    final shouldRecoverLegacy =
        isLegacy && isEmptyValue(localValue) && !isEmptyValue(remoteValue);
    return shouldRecoverLegacy ||
        localUpdatedAt == null ||
        remoteUpdatedAt.isAfter(localUpdatedAt);
  }

  static const Duration fullReconciliationInterval = Duration(minutes: 10);
  // Keep a small overlap because the client and database clocks may differ.
  static const Duration cursorOverlapWindow = Duration(minutes: 2);

  static bool shouldRunFullReconciliation({
    required DateTime? cursorAt,
    required DateTime? lastFullPullAt,
    required DateTime now,
  }) {
    if (cursorAt == null || lastFullPullAt == null) return true;
    if (cursorAt.isAfter(now) || lastFullPullAt.isAfter(now)) return true;
    return now.difference(lastFullPullAt) >= fullReconciliationInterval;
  }

  /// A full reconciliation must not seed its max timestamp from the old
  /// cursor: if the table is empty, the cursor must advance to the scan time.
  static DateTime? cursorSeedBeforePull({
    required DateTime? cursorAt,
    required bool fullPull,
    required DateTime now,
  }) {
    if (fullPull || cursorAt == null || cursorAt.isAfter(now)) return null;
    return cursorAt;
  }

  /// Establishes a checkpoint after an empty successful full scan. A small
  /// overlap protects against client/server clock skew: a row inserted just
  /// after the scan can still have a timestamp slightly behind the client clock.
  static DateTime? cursorAfterPull({
    required DateTime? newestSeen,
    required DateTime? previousCursorAt,
    required bool fullPull,
    required DateTime now,
  }) {
    if (newestSeen != null) {
      // Client/server clock skew can make a row timestamp appear to be in the
      // future. Clamp the cursor to scan time so every 60-second tick does not
      // trigger another full reconciliation until the local clock catches up.
      final candidate = newestSeen.isAfter(now) ? now : newestSeen;

      // The cursor is advanced only by syncable rows. If a delta page contains
      // only device-local/excluded rows, newestSeen remains equal to the prior
      // cursor and those old rows would be fetched on every 60-second tick.
      // Move such a stalled cursor forward with a bounded overlap; the periodic
      // full reconciliation remains the recovery path for late commits.
      if (!fullPull &&
          previousCursorAt != null &&
          !previousCursorAt.isAfter(now) &&
          !candidate.isAfter(previousCursorAt)) {
        final overlapCursor = now.subtract(cursorOverlapWindow);
        return previousCursorAt.isAfter(overlapCursor)
            ? previousCursorAt
            : overlapCursor;
      }

      if (fullPull) {
        // A full scan already visited every row, so seeding the next delta
        // cursor with a years-old row timestamp would fetch the whole table
        // again on the next tick. Advance old full-scan results to the bounded
        // overlap checkpoint; the periodic reconciliation recovers late commits.
        final overlapCursor = now.subtract(cursorOverlapWindow);
        final safeCandidate = candidate.isBefore(overlapCursor)
            ? overlapCursor
            : candidate;

        // Never move a valid checkpoint backward when a full scan sees only
        // older rows than the previously stored cursor.
        if (previousCursorAt != null &&
            !previousCursorAt.isAfter(now) &&
            previousCursorAt.isAfter(safeCandidate)) {
          return previousCursorAt;
        }
        return safeCandidate;
      }
      return candidate;
    }
    // Empty full scans have no row timestamp to advance from. Use a bounded
    // overlap rather than the exact client time so slightly-behind server
    // timestamps are not missed until the next periodic full reconciliation.
    if (!fullPull) return null;
    final fallbackCursor = now.subtract(cursorOverlapWindow);
    if (previousCursorAt != null &&
        !previousCursorAt.isAfter(now) &&
        previousCursorAt.isAfter(fallbackCursor)) {
      return previousCursorAt;
    }
    return fallbackCursor;
  }

  /// Build a partial update so changing one native AI setting cannot
  /// overwrite a separate preference owned by another UI/domain.
  static Map<String, dynamic> buildAiPreferencesPatch({
    required String userId,
    required dynamic localConfirm,
    required dynamic localMemory,
    required bool pushConfirm,
    required bool pushMemory,
  }) =>
      <String, dynamic>{
        'user_id': userId,
        if (pushConfirm && localConfirm is bool)
          'confirm_actions': localConfirm,
        if (pushMemory && localMemory is bool)
          'memory_level': localMemory ? 'limited' : 'none',
      };

  /// Convert only supported database enum values to the native boolean
  /// preference. Unknown values must not be interpreted as memory enabled.
  /// The native UI currently models memory as enabled/disabled, so both
  /// supported non-none levels map to true.
  static bool? aiMemoryEnabledFromLevel(dynamic level) {
    switch (level) {
      case 'none':
        return false;
      case 'limited':
      case 'complete':
        return true;
      default:
        return null;
    }
  }

  static bool shouldPropagateAiPreferences({
    required bool hadLocalMutation,
    required bool hasPendingMutation,
  }) {
    // Do not bypass outbox retry backoff by mirroring a still-pending local
    // value into the dedicated preferences table. Propagate only after every
    // local AI preference mutation has been acknowledged.
    return hadLocalMutation && !hasPendingMutation;
  }

  Future<void> syncNow() async {
    final activeClient = client;
    final userId = activeClient?.auth.currentUser?.id;
    if (activeClient == null || userId == null) return;
    // Guest/offline mutations must never be replayed under whichever account
    // happens to be signed in later.
    if (localStore.activeUserId != userId) return;
    if (_running) {
      // Account activation can request a sync while an older account's network
      // request is still unwinding. Queue one follow-up so the new account is
      // not left waiting for the next 60-second timer tick.
      _rerunRequested = true;
      return;
    }

    _running = true;
    try {
      const confirmKey = 'pace.settings.ai.confirm_actions';
      const memoryKey = 'pace.settings.ai.memory';
      final hadConfirmMutation = localStore.hasPendingOperationForKey(confirmKey);
      final hadMemoryMutation = localStore.hasPendingOperationForKey(memoryKey);
      await _pushPending(userId);
      if (!_isCurrentAccount(userId)) return;

      final confirmStillPending = localStore.hasPendingOperationForKey(confirmKey);
      final memoryStillPending = localStore.hasPendingOperationForKey(memoryKey);
      // Propagate each preference only if its own outbox mutation was
      // acknowledged. Updating confirm_actions must not rewrite an unrelated
      // memory_level, including the web client's distinct complete setting.
      final pushConfirm = shouldPropagateAiPreferences(
        hadLocalMutation: hadConfirmMutation,
        hasPendingMutation: confirmStillPending,
      );
      final pushMemory = shouldPropagateAiPreferences(
        hadLocalMutation: hadMemoryMutation,
        hasPendingMutation: memoryStillPending,
      );
      await _syncAiPreferences(
        expectedUserId: userId,
        pushConfirm: pushConfirm,
        pushMemory: pushMemory,
        preserveLocal: confirmStillPending || memoryStillPending,
      );
      if (!_isCurrentAccount(userId)) return;
      try {
        await _pullRemote(userId);
      } catch (_) {
        // Pulls are best-effort while offline. Keep local state intact and
        // retry on the next sync trigger instead of leaking an async error
        // from timer/auth callbacks into Flutter's uncaught-error handler.
      }
    } finally {
      _running = false;
      if (_rerunRequested) {
        _rerunRequested = false;
        unawaited(syncNow());
      }
    }
  }

  Future<void> _pushPending(String expectedUserId) async {
    // Inspect sync metadata as well as the outbox before persisting repairs.
    // Otherwise malformed metadata could remain only in memory when the
    // device is offline and the subsequent pull fails before its next write.
    localStore.syncedMetadata();
    final pending = List<Map<String, dynamic>>.from(localStore.pendingOperations());
    // The synchronous readers quarantine malformed reserved fields/entries.
    // Flush those repairs before an empty queue returns without another write.
    try {
      await localStore.persistOutboxRepairs(expectedUserId: expectedUserId);
    } catch (_) {
      // Do not let a local disk failure escape a timer/auth-triggered sync.
      // The existing on-disk outbox remains authoritative; retry next pass.
      return;
    }
    if (!_isCurrentAccount(expectedUserId)) return;
    for (final operation in pending) {
      if (!_isCurrentAccount(expectedUserId)) return;
      try {
        if (!isValidOutboxOperation(operation)) {
          await localStore.quarantineOperation(
            operation,
            expectedUserId: expectedUserId,
            reason: 'invalid-outbox-operation-shape',
          );
          continue;
        }
        final key = operation['key'] as String;
        if (!isSyncableKey(key)) {
          // Clear obsolete/device-local outbox entries without sending them to cloud.
          await localStore.acknowledgeOperation(operation, expectedUserId: expectedUserId);
          continue;
        }
        final result = await _push(operation, expectedUserId);
        if (!_isCurrentAccount(expectedUserId)) return;
        if (result.accepted) {
          await localStore.acknowledgeOperation(
            operation,
            expectedUserId: expectedUserId,
            syncedAt: result.remoteUpdatedAt,
          );
          continue;
        }

        // A newer server value won. Apply it locally before acknowledging the
        // stale mutation so it can never be retried over the newer state.
        if (!result.hasRemote || result.remoteUpdatedAt == null) {
          // A rejected RPC without a canonical row is ambiguous (for example,
          // a transient read/RLS failure). Keep the mutation queued and back off;
          // never silently discard a local change without a confirmed winner.
          await localStore.deferOperation(operation, expectedUserId: expectedUserId);
          continue;
        }
        if (!localStore.isPendingOperation(operation)) {
          // This request became stale because a newer local edit replaced its
          // outbox entry while the network call was in flight. Record the
          // server version and rebase the newer mutation's timestamp, but do
          // not overwrite the user's current local value with the conflict row.
          await localStore.acknowledgeOperation(
            operation,
            expectedUserId: expectedUserId,
            syncedAt: result.remoteUpdatedAt,
          );
          continue;
        }
        await localStore.applyRemote(
          operation['key'] as String,
          result.remoteValue,
          result.remoteUpdatedAt!,
          expectedUserId: expectedUserId,
        );
        if (!_isCurrentAccount(expectedUserId)) return;
        await localStore.acknowledgeOperation(operation, expectedUserId: expectedUserId);
      } catch (_) {
        try {
          await localStore.deferOperation(operation, expectedUserId: expectedUserId);
        } catch (_) {
          // An account switch is already in progress; leave the outbox untouched.
        }
        // Continue with independent keys. A transient failure on one key must
        // not starve unrelated mutations; this snapshot is finite and each
        // failed operation has already been deferred with bounded backoff.
        continue;
      }
    }
  }

  Future<_PushResult> _push(Map<String, dynamic> operation, String userId) async {
    if (!_isCurrentAccount(userId)) throw StateError('Account changed before sync push');
    final key = operation['key'] as String;
    final updatedAt = normalizedOutboxTimestamp(
      operation['queuedAt'],
      fallbackNow: DateTime.now().toUtc(),
    );
    final value = operation['operation'] == 'delete' ? null : operation['value'];

    final response = await client!.rpc('upsert_user_state_if_newer', params: {
      'p_user_id': userId,
      'p_key': key,
      'p_value': value,
      'p_updated_at': updatedAt,
      'p_updated_by': 'flutter-native',
    });

    if (!_isCurrentAccount(userId)) throw StateError('Account changed during sync push');
    if (isUserStateWriteAccepted(response)) {
      return _PushResult.accepted(
        remoteUpdatedAt: userStateWriteUpdatedAt(response, fallback: updatedAt),
      );
    }

    final rows = await client!
        .from('user_state')
        .select('key,value,updated_at')
        .eq('user_id', userId)
        .eq('key', key)
        .limit(1);
    if (!_isCurrentAccount(userId)) throw StateError('Account changed during sync conflict lookup');
    if (rows.isEmpty) return const _PushResult.rejected();
    final row = Map<String, dynamic>.from(rows.first);
    return _PushResult.rejectedWithRemote(
      remoteValue: row['value'],
      remoteUpdatedAt: row['updated_at'] as String?,
    );
  }

  Future<void> _syncAiPreferences({
    required String expectedUserId,
    required bool pushConfirm,
    required bool pushMemory,
    required bool preserveLocal,
  }) async {
    if (!_isCurrentAccount(expectedUserId)) return;
    final user = client!.auth.currentUser;
    if (user == null || user.id != expectedUserId) return;

    try {
      if (pushConfirm || pushMemory) {
        final localConfirm = localStore.read('pace.settings.ai.confirm_actions');
        final localMemory = localStore.read('pace.settings.ai.memory');
        final patch = buildAiPreferencesPatch(
          userId: user.id,
          localConfirm: localConfirm,
          localMemory: localMemory,
          pushConfirm: pushConfirm,
          pushMemory: pushMemory,
        );
        if (patch.length > 1) await client!.from('ai_preferences').upsert(patch);
        return;
      }

      // Do not pull cloud preferences over a local mutation waiting for retry.
      if (preserveLocal) return;

      final rows = await client!
          .from('ai_preferences')
          .select('confirm_actions,memory_level')
          .eq('user_id', user.id)
          .limit(1);
      if (!_isCurrentAccount(expectedUserId) || rows.isEmpty) return;
      final row = Map<String, dynamic>.from(rows.first);
      final remoteConfirm = row['confirm_actions'];
      final remoteMemory = row['memory_level'];
      if (!_isCurrentAccount(expectedUserId)) return;
      if (remoteConfirm is bool &&
          localStore.read('pace.settings.ai.confirm_actions') != remoteConfirm) {
        await localStore.writeForAccount(expectedUserId, 'pace.settings.ai.confirm_actions', remoteConfirm, enqueueSync: false);
      }
      if (!_isCurrentAccount(expectedUserId)) return;
      final memoryEnabled = aiMemoryEnabledFromLevel(remoteMemory);
      if (memoryEnabled != null &&
          localStore.read('pace.settings.ai.memory') != memoryEnabled) {
        await localStore.writeForAccount(
          expectedUserId,
          'pace.settings.ai.memory',
          memoryEnabled,
          enqueueSync: false,
        );
      }
    } catch (_) {
      // Cloud preference sync is best-effort; local settings remain available.
    }
  }

  Future<void> _pullRemote(String userId) async {
    if (!_isCurrentAccount(userId)) return;
    final now = DateTime.now().toUtc();
    final rawCursor = localStore.read('pace.__sync_last_pull_at');
    final rawLastFullPull = localStore.read('pace.__sync_last_full_pull_at');
    final cursorAt = rawCursor is String && LocalStore.isValidIsoTimestamp(rawCursor)
        ? DateTime.tryParse(rawCursor)?.toUtc()
        : null;
    final lastFullPullAt =
        rawLastFullPull is String && LocalStore.isValidIsoTimestamp(rawLastFullPull)
            ? DateTime.tryParse(rawLastFullPull)?.toUtc()
            : null;
    final fullPull = shouldRunFullReconciliation(
      cursorAt: cursorAt,
      lastFullPullAt: lastFullPullAt,
      now: now,
    );

    // Most passes fetch only rows changed since the last cursor. A bounded full
    // reconciliation catches late commits, clock skew, and any gap caused by a
    // concurrent write sharing an update timestamp. Cursor metadata is local to
    // the account-scoped file and is never enqueued for cloud sync. Page results
    // so accounts with more than PostgREST's default row cap do not silently skip
    // keys when the cursor advances.
    const pageSize = 500;
    var offset = 0;
    var appliedRemoteRows = false;
    var newestSeen = cursorSeedBeforePull(
      cursorAt: cursorAt,
      fullPull: fullPull,
      now: now,
    );
    while (true) {
      final rows = fullPull
          ? await client!
              .from('user_state')
              .select('key,value,updated_at')
              .eq('user_id', userId)
              .order('updated_at', ascending: true)
              .order('key', ascending: true)
              .range(offset, offset + pageSize - 1)
          : await client!
              .from('user_state')
              .select('key,value,updated_at')
              .eq('user_id', userId)
              .gte('updated_at', cursorAt!.toIso8601String())
              .order('updated_at', ascending: true)
              .order('key', ascending: true)
              .range(offset, offset + pageSize - 1);
      if (!_isCurrentAccount(userId)) return;

      for (final raw in rows) {
        if (!_isCurrentAccount(userId)) return;
        final row = Map<String, dynamic>.from(raw);
        final rawKey = row['key'] as String;
        final isLegacy = rawKey.startsWith('lt.');
        final key = normalizeRemoteKey(rawKey);
        final remoteUpdatedAt = row['updated_at'] as String?;
        final remoteTime = remoteUpdatedAt == null ||
                !LocalStore.isValidIsoTimestamp(remoteUpdatedAt)
            ? null
            : DateTime.tryParse(remoteUpdatedAt)?.toUtc();
        // Device-local rows must not advance the cloud-sync cursor; otherwise
        // an excluded key could move the checkpoint past a late syncable write.
        if (isSyncableKey(key) &&
            remoteTime != null &&
            (newestSeen == null || remoteTime.isAfter(newestSeen))) {
          newestSeen = remoteTime;
        }
        if (!isSyncableKey(key) ||
            remoteUpdatedAt == null ||
            remoteTime == null ||
            localStore.hasPendingOperationForKey(key)) {
          continue;
        }

        final rawLocalUpdatedAt = localStore.lastSyncedAt(key);
        final localTime = rawLocalUpdatedAt == null ||
                !LocalStore.isValidIsoTimestamp(rawLocalUpdatedAt)
            ? null
            : DateTime.tryParse(rawLocalUpdatedAt)?.toUtc();
        if (!shouldApplyRemoteValue(
          isLegacy: isLegacy,
          localValue: localStore.read(key),
          remoteValue: row['value'],
          localUpdatedAt: localTime,
          remoteUpdatedAt: remoteTime,
        )) {
          continue;
        }
        await localStore.applyRemote(
          key,
          row['value'],
          remoteUpdatedAt,
          expectedUserId: userId,
          notify: false,
        );
        appliedRemoteRows = true;
      }

      if (rows.length < pageSize) break;
      offset += pageSize;
    }

    if (!_isCurrentAccount(userId)) return;
    final cursorToSave = cursorAfterPull(
      newestSeen: newestSeen,
      previousCursorAt: cursorAt,
      fullPull: fullPull,
      now: now,
    );
    if (cursorToSave != null) {
      await localStore.writeForAccount(
        userId,
        'pace.__sync_last_pull_at',
        cursorToSave.toIso8601String(),
        enqueueSync: false,
        notify: false,
      );
    }
    if (fullPull) {
      await localStore.writeForAccount(
        userId,
        'pace.__sync_last_full_pull_at',
        now.toIso8601String(),
        enqueueSync: false,
        notify: false,
      );
    }
    if (appliedRemoteRows) {
      localStore.notifyStateChanged();
    }
  }
}

class _PushResult {
  const _PushResult.accepted({required this.remoteUpdatedAt})
      : accepted = true,
        hasRemote = false,
        remoteValue = null;

  const _PushResult.rejected()
      : accepted = false,
        hasRemote = false,
        remoteValue = null,
        remoteUpdatedAt = null;

  const _PushResult.rejectedWithRemote({
    required this.remoteValue,
    required this.remoteUpdatedAt,
  }) : accepted = false,
       hasRemote = true;

  final bool accepted;
  final bool hasRemote;
  final dynamic remoteValue;
  final String? remoteUpdatedAt;
}
