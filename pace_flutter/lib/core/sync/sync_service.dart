import 'dart:async';

import '../storage/local_store.dart';
import '../supabase/pace_supabase.dart';
import 'sync_contract.dart';

class SyncService {
  SyncService({required this.localStore, required this.auth});

  final LocalStore localStore;
  final PaceAuthService auth;
  bool _running = false;

  Future<void> syncNow() async {
    if (_running) return;
    final client = auth.client;
    final user = auth.currentUser;
    if (client == null || user == null) return;

    _running = true;
    try {
      await _pushPending();
      await _pullRemote();
    } finally {
      _running = false;
    }
  }

  Future<void> _pushPending() async {
    final client = auth.client;
    final user = auth.currentUser;
    if (client == null || user == null) return;

    for (final operation in localStore.pendingOperations()) {
      try {
        final result = await _push(operation);
        if (!result.accepted && result.remoteValue != null && result.remoteUpdatedAt != null) {
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
    final client = auth.client!;
    final userId = client.auth.currentUser!.id;
    final key = operation['key'] as String;
    final updatedAt = (operation['queuedAt'] as String?) ?? DateTime.now().toUtc().toIso8601String();
    final value = operation['operation'] == 'delete' ? null : operation['value'];

    final response = await client.rpc('upsert_user_state_if_newer', params: {
      'p_user_id': userId,
      'p_key': key,
      'p_value': value,
      'p_updated_at': updatedAt,
      'p_updated_by': 'flutter-native',
    });

    if (response == true) return const _PushResult.accepted();

    final rows = await client
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

  Future<void> _pullRemote() async {
    final client = auth.client!;
    final userId = client.auth.currentUser!.id;
    final rows = await client
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
  const _PushResult({required this.accepted, this.remoteValue, this.remoteUpdatedAt});
  const _PushResult.accepted() : this(accepted: true);
  const _PushResult.rejected() : this(accepted: false);
  const _PushResult.rejectedWithRemote({required dynamic remoteValue, required String? remoteUpdatedAt})
      : this(accepted: false, remoteValue: remoteValue, remoteUpdatedAt: remoteUpdatedAt);

  final bool accepted;
  final dynamic remoteValue;
  final String? remoteUpdatedAt;
}
