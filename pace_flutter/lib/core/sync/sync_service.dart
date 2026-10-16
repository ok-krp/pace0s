import 'package:supabase_flutter/supabase_flutter.dart';

import '../storage/local_store.dart';

/// Replays local mutations through Pace's existing user_state RPC and pulls
/// newer remote state. Local writes remain durable while offline.
class SyncService {
  SyncService({required this.localStore, required this.client});

  final LocalStore localStore;
  final SupabaseClient? client;
  bool _running = false;

  bool _isCurrentAccount(String expectedUserId) =>
      client?.auth.currentUser?.id == expectedUserId &&
      localStore.activeUserId == expectedUserId;

  /// The RPC returns a JSON object with an `accepted` field, not a bare bool.
  /// Accept the legacy bool shape too so an older compatible backend still works.
  static bool isUserStateWriteAccepted(dynamic response) {
    if (response == true) return true;
    return response is Map && response['accepted'] == true;
  }

  Future<void> syncNow() async {
    final activeClient = client;
    final userId = activeClient?.auth.currentUser?.id;
    if (_running || activeClient == null || userId == null) return;
    // Guest/offline mutations must never be replayed under whichever account
    // happens to be signed in later.
    if (localStore.activeUserId != userId) return;

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
      final hasDueAiPreferenceMutation =
          localStore.hasDueOperationForKey('pace.settings.ai.confirm_actions') ||
          localStore.hasDueOperationForKey('pace.settings.ai.memory');
      // If a local preference write was acknowledged, propagate it to the
      // dedicated ai_preferences table. If it is still deferred by backoff,
      // preserve the local choice but do not bypass retry scheduling.
      final shouldPushAiPreferences = hadLocalAiPreferenceMutation &&
          (!hasPendingAiPreferenceMutation || hasDueAiPreferenceMutation);
      await _syncAiPreferences(
        expectedUserId: userId,
        pushLocal: shouldPushAiPreferences,
        preserveLocal: hasPendingAiPreferenceMutation,
      );
      if (!_isCurrentAccount(userId)) return;
      await _pullRemote(userId);
    } finally {
      _running = false;
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
        break;
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
      if (remoteConfirm is bool) {
        await localStore.write('pace.settings.ai.confirm_actions', remoteConfirm, enqueueSync: false);
      }
      if (!_isCurrentAccount(expectedUserId)) return;
      if (remoteMemory is String) {
        await localStore.write('pace.settings.ai.memory', remoteMemory != 'none', enqueueSync: false);
      }
    } catch (_) {
      // Cloud preference sync is best-effort; local settings remain available.
    }
  }

  Future<void> _pullRemote(String userId) async {
    if (!_isCurrentAccount(userId)) return;
    final rows = await client!
        .from('user_state')
        .select('key,value,updated_at')
        .eq('user_id', userId);
    if (!_isCurrentAccount(userId)) return;

    for (final raw in rows) {
      if (!_isCurrentAccount(userId)) return;
      final row = Map<String, dynamic>.from(raw);
      final key = row['key'] as String;
      final remoteUpdatedAt = row['updated_at'] as String?;
      if (remoteUpdatedAt == null || localStore.hasPendingOperationForKey(key)) continue;

      final localUpdatedAt = localStore.lastSyncedAt(key);
      if (localUpdatedAt != null) {
        final remoteTime = DateTime.tryParse(remoteUpdatedAt);
        final localTime = DateTime.tryParse(localUpdatedAt);
        if (remoteTime != null && localTime != null && !remoteTime.isAfter(localTime)) continue;
      }
      await localStore.applyRemote(key, row['value'], remoteUpdatedAt, expectedUserId: userId);
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
