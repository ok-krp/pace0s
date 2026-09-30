import 'package:supabase_flutter/supabase_flutter.dart';

import '../storage/local_store.dart';

/// Replays local mutations through Pace's existing user_state RPC and pulls
/// newer remote state. Local writes remain durable while offline.
class SyncService {
  SyncService({required this.localStore, required this.client});

  final LocalStore localStore;
  final SupabaseClient? client;
  bool _running = false;
  RealtimeChannel? _realtimeChannel;
  String? _realtimeUserId;

  Future<void> syncNow() async {
    if (_running || client == null || client!.auth.currentUser == null) return;
    _running = true;
    try {
      await _ensureRealtimeSubscription(user.id);
      final hadLocalAiPreferenceMutation = localStore.pendingOperations().any(
        (operation) => operation['key'] == 'pace.settings.ai.confirm_actions' || operation['key'] == 'pace.settings.ai.memory',
      );
      await _pushPending();
      await _syncAiPreferences(pushLocal: hadLocalAiPreferenceMutation);
      await _pullRemote();
    } finally {
      _running = false;
    }
  }

  Future<void> _ensureRealtimeSubscription(String userId) async {
    if (_realtimeUserId == userId && _realtimeChannel != null) return;

    if (_realtimeChannel != null) {
      await client!.removeChannel(_realtimeChannel!);
      _realtimeChannel = null;
    }

    final channel = client!.channel('pace-flutter-user-state-$userId');
    channel.onPostgresChanges(
      event: PostgresChangeEvent.all,
      schema: 'public',
      table: 'user_state',
      filter: PostgresChangeFilter(
        type: PostgresChangeFilterType.eq,
        column: 'user_id',
        value: userId,
      ),
      callback: (payload) {
        final record = Map<String, dynamic>.from(payload.newRecord);
        final key = record['key'];
        final value = record['value'];
        final updatedAt = record['updated_at'];
        if (key is! String || updatedAt is! String) return;
        unawaited(_applyRealtimeRow(key, value, updatedAt));
      },
    );
    _realtimeChannel = channel;
    _realtimeUserId = userId;

    try {
      await channel.subscribe();
    } catch (_) {
      // Polling remains the fallback when Realtime is unavailable.
    }
  }

  Future<void> _applyRealtimeRow(
    String key,
    dynamic value,
    String updatedAt,
  ) async {
    if (_running) {
      // The regular sync cycle will reconcile this row after its current
      // mutation batch completes, preventing a transient overwrite.
      return;
    }

    final localUpdatedAt = localStore.lastSyncedAt(key);
    final remoteTime = DateTime.tryParse(updatedAt);
    final localTime = localUpdatedAt == null ? null : DateTime.tryParse(localUpdatedAt);
    if (remoteTime == null || (localTime != null && !remoteTime.isAfter(localTime))) {
      return;
    }

    if (localStore.pendingOperations().any((operation) => operation['key'] == key)) {
      return;
    }

    await localStore.applyRemote(key, value, updatedAt);
  }

  Future<void> _pushPending() async {
    for (final operation in List<Map<String, dynamic>>.from(localStore.pendingOperations())) {
      try {
        final result = await _push(operation);
        if (result.accepted) {
          if (result.serverUpdatedAt != null) {
            await localStore.markSyncedAt(
              operation['key'] as String,
              result.serverUpdatedAt!,
            );
          }
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

    final write = CloudSyncWriteResponse.fromRpc(response);
    if (write.accepted) {
      return _PushResult.accepted(write.updatedAt);
    }

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

  Future<void> _syncAiPreferences({required bool pushLocal}) async {
    final user = client!.auth.currentUser;
    if (user == null) return;

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

      final rows = await client!
          .from('ai_preferences')
          .select('confirm_actions,memory_level')
          .eq('user_id', user.id)
          .limit(1);
      if (rows.isEmpty) return;
      final row = Map<String, dynamic>.from(rows.first);
      final remoteConfirm = row['confirm_actions'];
      final remoteMemory = row['memory_level'];
      if (remoteConfirm is bool) {
        await localStore.write('pace.settings.ai.confirm_actions', remoteConfirm, enqueueSync: false);
      }
      if (remoteMemory is String) {
        await localStore.write('pace.settings.ai.memory', remoteMemory != 'none', enqueueSync: false);
      }
    } catch (_) {
      // Cloud preference sync is best-effort; local settings remain available.
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

/// Validated response contract returned by upsert_user_state_if_newer().
class CloudSyncWriteResponse {
  const CloudSyncWriteResponse({
    required this.accepted,
    required this.updatedAt,
  });

  final bool accepted;
  final String updatedAt;

  factory CloudSyncWriteResponse.fromRpc(dynamic response) {
    if (response is! Map) {
      throw const FormatException('invalid cloud sync write response');
    }
    final accepted = response['accepted'];
    final updatedAt = response['updated_at'];
    if (accepted is! bool || updatedAt is! String || updatedAt.isEmpty) {
      throw const FormatException('invalid cloud sync write response');
    }
    return CloudSyncWriteResponse(
      accepted: accepted,
      updatedAt: updatedAt,
    );
  }
}

class _PushResult {
  const _PushResult.accepted(this.serverUpdatedAt)
      : accepted = true,
        remoteValue = null,
        remoteUpdatedAt = null;

  const _PushResult.rejected()
      : accepted = false,
        serverUpdatedAt = null,
        remoteValue = null,
        remoteUpdatedAt = null;

  const _PushResult.rejectedWithRemote({
    required this.remoteValue,
    required this.remoteUpdatedAt,
  })  : accepted = false,
        serverUpdatedAt = null;

  final bool accepted;
  final String? serverUpdatedAt;
  final dynamic remoteValue;
  final String? remoteUpdatedAt;
}
