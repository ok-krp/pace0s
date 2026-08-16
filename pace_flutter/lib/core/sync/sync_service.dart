import 'package:supabase_flutter/supabase_flutter.dart';

import '../storage/local_store.dart';

/// Replays local mutations through Pace's existing user_state RPC and pulls
/// newer remote state. Local writes remain durable while offline.
class SyncService {
  SyncService({required this.localStore, required this.client});

  final LocalStore localStore;
  final SupabaseClient? client;
  bool _running = false;

  Future<void> syncNow() async {
    if (_running || client == null || client!.auth.currentUser == null) return;
    _running = true;
    try {
      await _pushPending();
      await _syncAiPreferences();
      await _pullRemote();
    } finally {
      _running = false;
    }
  }

  Future<void> _pushPending() async {
    for (final operation in List<Map<String, dynamic>>.from(localStore.pendingOperations())) {
      try {
        final result = await _push(operation);
        if (result.accepted) {
          await localStore.acknowledgeOperation(operation);
          continue;
        }

        // A newer server value won. Apply it locally before acknowledging the
        // stale mutation so it can never be retried over the newer state.
        if (result.remoteValue != null && result.remoteUpdatedAt != null) {
          await localStore.applyRemote(
            operation['key'] as String,
            result.remoteValue,
            result.remoteUpdatedAt!,
          );
        }
        await localStore.acknowledgeOperation(operation);
      } catch (_) {
        // Preserve the operation for the next reconnect/retry.
        break;
      }
    }
  }

  Future<_PushResult> _push(Map<String, dynamic> operation) async {
    final userId = client!.auth.currentUser!.id;
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

    if (response == true) return const _PushResult.accepted();

    final rows = await client!
        .from('user_state')
        .select('key,value,updated_at')
        .eq('user_id', userId)
        .eq('key', key)
        .limit(1);
    if (rows.isEmpty) return const _PushResult.rejected();
    final row = Map<String, dynamic>.from(rows.first);
    return _PushResult.rejectedWithRemote(
      remoteValue: row['value'],
      remoteUpdatedAt: row['updated_at'] as String?,
    );
  }

  Future<void> _syncAiPreferences() async {
    final user = client!.auth.currentUser;
    if (user == null) return;

    final localConfirm = localStore.read('pace.settings.ai.confirm_actions');
    final localMemory = localStore.read('pace.settings.ai.memory');
    final patch = <String, dynamic>{
      'user_id': user.id,
      if (localConfirm is bool) 'confirm_actions': localConfirm,
      if (localMemory is bool) 'memory_level': localMemory ? 'limited' : 'none',
    };
    if (patch.length == 1) return;

    try {
      await client!.from('ai_preferences').upsert(patch);
    } catch (_) {
      // The local settings remain authoritative until the next successful sync.
    }
  }

  Future<void> _pullRemote() async {
    final userId = client!.auth.currentUser!.id;
    final rows = await client!
        .from('user_state')
        .select('key,value,updated_at')
        .eq('user_id', userId);

    for (final raw in rows) {
      final row = Map<String, dynamic>.from(raw);
      final key = row['key'] as String;
      final remoteUpdatedAt = row['updated_at'] as String?;
      if (remoteUpdatedAt == null || localStore.pendingOperations().any((op) => op['key'] == key)) continue;

      final localUpdatedAt = localStore.lastSyncedAt(key);
      if (localUpdatedAt != null) {
        final remoteTime = DateTime.tryParse(remoteUpdatedAt);
        final localTime = DateTime.tryParse(localUpdatedAt);
        if (remoteTime != null && localTime != null && !remoteTime.isAfter(localTime)) continue;
      }
      await localStore.applyRemote(key, row['value'], remoteUpdatedAt);
    }
  }
}

class _PushResult {
  const _PushResult.accepted()
      : accepted = true,
        remoteValue = null,
        remoteUpdatedAt = null;

  const _PushResult.rejected()
      : accepted = false,
        remoteValue = null,
        remoteUpdatedAt = null;

  const _PushResult.rejectedWithRemote({
    required dynamic remoteValue,
    required String? remoteUpdatedAt,
  })  : accepted = false,
        remoteValue = remoteValue,
        remoteUpdatedAt = remoteUpdatedAt;

  final bool accepted;
  final dynamic remoteValue;
  final String? remoteUpdatedAt;
}
