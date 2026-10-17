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

  /// The RPC returns a JSON object with an `accepted` field, not a bare bool.
  /// Accept the legacy bool shape too so an older compatible backend still works.
  static bool isUserStateWriteAccepted(dynamic response) {
    if (response == true) return true;
    return response is Map && response['accepted'] == true;
  }

  static const Duration fullReconciliationInterval = Duration(minutes: 10);

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

  /// Advances an empty successful full scan to its scan time. Without this,
  /// an account with no valid rows would keep a null cursor and repeat a full
  /// table read on every sync tick instead of using delta reads until reconcile.
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
      // A full scan can see only old rows. Never move a valid cursor backward
      // just because the newest row timestamp predates it.
      if (fullPull &&
          previousCursorAt != null &&
          !previousCursorAt.isAfter(now) &&
          previousCursorAt.isAfter(candidate)) {
        return previousCursorAt;
      }
      return candidate;
    }
    // Empty full scans have no row timestamp to advance from. Use the scan
    // time, but only after the full query succeeded.
    return fullPull ? now : null;
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
      final hadLocalAiPreferenceMutation =
          localStore.hasPendingOperationForKey('pace.settings.ai.confirm_actions') ||
          localStore.hasPendingOperationForKey('pace.settings.ai.memory');
      await _pushPending(userId);
      if (!_isCurrentAccount(userId)) return;

      final hasPendingAiPreferenceMutation =
          localStore.hasPendingOperationForKey('pace.settings.ai.confirm_actions') ||
          localStore.hasPendingOperationForKey('pace.settings.ai.memory');
      // If a local preference write was acknowledged, propagate it to the
      // dedicated ai_preferences table. If it is still deferred by backoff,
      // preserve the local choice but do not bypass retry scheduling.
      final shouldPushAiPreferences = shouldPropagateAiPreferences(
        hadLocalMutation: hadLocalAiPreferenceMutation,
        hasPendingMutation: hasPendingAiPreferenceMutation,
      );
      await _syncAiPreferences(
        expectedUserId: userId,
        pushLocal: shouldPushAiPreferences,
        preserveLocal: hasPendingAiPreferenceMutation,
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
    for (final operation in List<Map<String, dynamic>>.from(localStore.pendingOperations())) {
      if (!_isCurrentAccount(expectedUserId)) return;
      try {
        final result = await _push(operation, expectedUserId);
        if (!_isCurrentAccount(expectedUserId)) return;
        if (result.accepted) {
          await localStore.acknowledgeOperation(operation, expectedUserId: expectedUserId);
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
    final updatedAt = (operation['queuedAt'] as String?) ?? DateTime.now().toUtc().toIso8601String();
    final value = operation['operation'] == 'delete' ? null : operation['value'];

    final response = await client!.rpc('upsert_user_state_if_newer', params: {
      'p_user_id': userId,
      'p_key': key,
      'p_value': value,
      'p_updated_at': updatedAt,
      'p_updated_by': 'flutter-native',
    });

    if (!_isCurrentAccount(userId)) throw StateError('Account changed during sync push');
    if (isUserStateWriteAccepted(response)) return const _PushResult.accepted();

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
    required bool pushLocal,
    required bool preserveLocal,
  }) async {
    if (!_isCurrentAccount(expectedUserId)) return;
    final user = client!.auth.currentUser;
    if (user == null || user.id != expectedUserId) return;

    try {
      if (pushLocal) {
        final localConfirm = localStore.read('pace.settings.ai.confirm_actions');
        final localMemory = localStore.read('pace.settings.ai.memory');
        final patch = <String, dynamic>{
          'user_id': user.id,
          if (localConfirm is bool) 'confirm_actions': localConfirm,
          if (localMemory is bool) 'memory_level': localMemory ? 'limited' : 'none',
        };
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
        await localStore.write('pace.settings.ai.confirm_actions', remoteConfirm, enqueueSync: false);
      }
      if (!_isCurrentAccount(expectedUserId)) return;
      if (remoteMemory is String) {
        final memoryEnabled = remoteMemory != 'none';
        if (localStore.read('pace.settings.ai.memory') != memoryEnabled) {
          await localStore.write('pace.settings.ai.memory', memoryEnabled, enqueueSync: false);
        }
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
    final cursorAt = rawCursor is String
        ? DateTime.tryParse(rawCursor)?.toUtc()
        : null;
    final lastFullPullAt = rawLastFullPull is String
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
        final key = row['key'] as String;
        final remoteUpdatedAt = row['updated_at'] as String?;
        final remoteTime = remoteUpdatedAt == null
            ? null
            : DateTime.tryParse(remoteUpdatedAt)?.toUtc();
        if (remoteTime != null &&
            (newestSeen == null || remoteTime.isAfter(newestSeen))) {
          newestSeen = remoteTime;
        }
        if (remoteUpdatedAt == null || remoteTime == null || localStore.hasPendingOperationForKey(key)) continue;

        final localUpdatedAt = localStore.lastSyncedAt(key);
        if (localUpdatedAt != null) {
          final localTime = DateTime.tryParse(localUpdatedAt);
          if (localTime != null &&
              !remoteTime.isAfter(localTime)) {
            continue;
          }
        }
        await localStore.applyRemote(
          key,
          row['value'],
          remoteUpdatedAt,
          expectedUserId: userId,
        );
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
      await localStore.write(
        'pace.__sync_last_pull_at',
        cursorToSave.toIso8601String(),
        enqueueSync: false,
      );
    }
    if (fullPull) {
      await localStore.write(
        'pace.__sync_last_full_pull_at',
        now.toIso8601String(),
        enqueueSync: false,
      );
    }
  }
}

class _PushResult {
  const _PushResult.accepted()
      : accepted = true,
        hasRemote = false,
        remoteValue = null,
        remoteUpdatedAt = null;

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
