import 'dart:async';
import 'dart:math';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../storage/local_store.dart';

/// Replays local mutations through Pace's existing user_state RPC and pulls
/// newer remote state. Local writes remain durable while offline.
class SyncService {
  SyncService({required this.localStore, required this.client}) {
    localStore.onLocalMutation = () async {
      await syncNow();
    };
  }

  final LocalStore localStore;
  final SupabaseClient? client;
  bool _running = false;
  bool _syncRequestedWhileRunning = false;
  bool _realtimeHealthy = false;
  bool _realtimeNeedsPull = false;
  // Keep failed writes queued and retry them on the bounded recovery cadence,
  // even when Realtime itself remains healthy.
  bool _pendingRetryNeeded = false;
  String? _deviceId;
  RealtimeChannel? _realtimeChannel;
  String? _realtimeUserId;

  Future<void> recoverIfNeeded() async {
    if (_realtimeHealthy && !_realtimeNeedsPull && !_pendingRetryNeeded) return;
    await syncNow();
  }

  Future<void> syncNow() async {
    final supabaseClient = client;
    if (supabaseClient == null) return;
    final user = supabaseClient.auth.currentUser;
    if (user == null) {
      await _clearRealtimeSubscription();
      return;
    }
    if (_running) {
      _syncRequestedWhileRunning = true;
      return;
    }
    _running = true;
    try {
      final deviceId = await _ensureDeviceId();
      await _ensureRealtimeSubscription(user.id, deviceId);
      final hadLocalAiPreferenceMutation = localStore.pendingOperations().any(
        (operation) =>
            operation['key'] == 'pace.settings.ai.confirm_actions' ||
            operation['key'] == 'pace.settings.ai.memory',
      );
      await _pushPending();
      await _syncAiPreferences(pushLocal: hadLocalAiPreferenceMutation);
      if (!_realtimeHealthy || _realtimeNeedsPull) {
        _realtimeNeedsPull = false;
        try {
          await _pullRemote();
        } catch (_) {
          // Keep the pull pending for the bounded recovery fallback. Do not
          // immediately retry in a tight loop after a network/provider error.
          _realtimeNeedsPull = true;
          _syncRequestedWhileRunning = false;
          rethrow;
        }
      }
    } finally {
      _running = false;
      if (_syncRequestedWhileRunning) {
        _syncRequestedWhileRunning = false;
        if (localStore.pendingOperations().isNotEmpty || _realtimeNeedsPull) {
          unawaited(syncNow());
        }
      }
    }
  }

  Future<String> _ensureDeviceId() async {
    final existing = localStore.read('pace.__sync_device_id');
    if (existing is String && existing.isNotEmpty) {
      _deviceId = existing;
      return existing;
    }
    final random = Random.secure();
    final id = List<int>.generate(16, (_) => random.nextInt(256))
        .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
        .join();
    final deviceId = 'flutter-$id';
    await localStore.write('pace.__sync_device_id', deviceId, enqueueSync: false);
    _deviceId = deviceId;
    return deviceId;
  }

  Future<void> _clearRealtimeSubscription() async {
    final channel = _realtimeChannel;
    _realtimeChannel = null;
    _realtimeUserId = null;
    _realtimeHealthy = false;
    _realtimeNeedsPull = false;
    _syncRequestedWhileRunning = false;
    _pendingRetryNeeded = false;
    if (channel == null) return;
    try {
      await client?.removeChannel(channel);
    } catch (_) {
      // Auth is already cleared locally; a failed remote channel cleanup must
      // never keep the previous account's events eligible for application.
    }
  }

  Future<void> _ensureRealtimeSubscription(String userId, String deviceId) async {
    if (_realtimeUserId == userId && _realtimeChannel != null && _realtimeHealthy) return;

    if (_realtimeChannel != null) {
      await client!.removeChannel(_realtimeChannel!);
      _realtimeChannel = null;
      _realtimeUserId = null;
    }

    _realtimeHealthy = false;
    _realtimeNeedsPull = false;
    final channel = client!.channel('pace-flutter-user-state-$userId');

    void handlePayload(PostgresChangePayload payload) {
      // Reject late callbacks from a signed-out or previous account before
      // touching local storage. Removing a channel is asynchronous, so cleanup
      // alone is not a sufficient account-isolation boundary.
      if (!shouldAcceptRealtimeUserStateForAccount(
        authenticatedUserId: client?.auth.currentUser?.id,
        subscribedUserId: userId,
        activeRealtimeUserId: _realtimeUserId,
      )) {
        return;
      }
      // INSERT/UPDATE only: DELETE/tombstone semantics are handled separately.
      final record = Map<String, dynamic>.from(payload.newRecord);
      if (record['updated_by'] == deviceId) return;
      final key = record['key'];
      final value = record['value'];
      final updatedAt = record['updated_at'];
      if (key is! String || updatedAt is! String) return;
      unawaited(_applyRealtimeRow(key, value, updatedAt, userId));
    }

    channel
        .onPostgresChanges(
          event: PostgresChangeEvent.insert,
          schema: 'public',
          table: 'user_state',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'user_id',
            value: userId,
          ),
          callback: handlePayload,
        )
        .onPostgresChanges(
          event: PostgresChangeEvent.update,
          schema: 'public',
          table: 'user_state',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'user_id',
            value: userId,
          ),
          callback: handlePayload,
        );

    _realtimeChannel = channel;
    _realtimeUserId = userId;

    try {
      channel.subscribe((status, error) {
        switch (status) {
          case RealtimeSubscribeStatus.subscribed:
            _realtimeHealthy = true;
            _realtimeNeedsPull = true;
            // Realtime does not replay existing rows. Schedule a full pull
            // after subscription is confirmed, including when syncNow is
            // already inside its initial push.
            if (_running) {
              _syncRequestedWhileRunning = true;
            } else {
              unawaited(syncNow());
            }
            break;
          case RealtimeSubscribeStatus.channelError:
          case RealtimeSubscribeStatus.timedOut:
          case RealtimeSubscribeStatus.closed:
            _realtimeHealthy = false;
            // The next syncNow() must create a fresh channel rather than
            // reusing a channel that is no longer subscribed.
            if (identical(_realtimeChannel, channel)) {
              _realtimeChannel = null;
              _realtimeUserId = null;
            }
            break;
        }
      });
    } catch (_) {
      _realtimeChannel = null;
      _realtimeUserId = null;
      _realtimeHealthy = false;
      // Polling remains the fallback when Realtime is unavailable.
    }
  }

  Future<void> _applyRealtimeRow(
    String key,
    dynamic value,
    String updatedAt,
    String subscribedUserId,
  ) async {
    if (!shouldAcceptRealtimeUserStateForAccount(
      authenticatedUserId: client?.auth.currentUser?.id,
      subscribedUserId: subscribedUserId,
      activeRealtimeUserId: _realtimeUserId,
    )) {
      return;
    }
    if (_running) {
      _realtimeNeedsPull = true;
      _syncRequestedWhileRunning = true;
      return;
    }

    final localUpdatedAt = localStore.lastSyncedAt(key);
    final remoteTime = DateTime.tryParse(updatedAt);
    final localTime =
        localUpdatedAt == null ? null : DateTime.tryParse(localUpdatedAt);
    if (!shouldApplyRealtimeUserState(
      remoteTime: remoteTime,
      localTime: localTime,
      hasPendingMutation: localStore
          .pendingOperations()
          .any((operation) => operation['key'] == key),
    )) {
      return;
    }

    await localStore.applyRemote(key, value, updatedAt);
  }

  Future<void> _pushPending() async {
    _pendingRetryNeeded = false;
    for (final operation in List<Map<String, dynamic>>.from(
      localStore.pendingOperations(),
    )) {
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

        // A rejected write is only safe to acknowledge after a canonical
        // server row is confirmed. If that row is temporarily missing (for
        // example during a concurrent delete/recreate), retain the local
        // operation and retry it on the bounded recovery cadence.
        if (result.remoteUpdatedAt == null) {
          _pendingRetryNeeded = true;
          continue;
        }
        await localStore.applyRemote(
          operation['key'] as String,
          result.remoteValue,
          result.remoteUpdatedAt!,
        );
        await localStore.acknowledgeOperation(operation);
      } catch (_) {
        // Preserve the operation for the next bounded recovery retry.
        _pendingRetryNeeded = true;
        break;
      }
    }
  }

  Future<_PushResult> _push(Map<String, dynamic> operation) async {
    final userId = client!.auth.currentUser!.id;
    final key = operation['key'] as String;
    final updatedAt = (operation['queuedAt'] as String?) ??
        DateTime.now().toUtc().toIso8601String();
    final value =
        operation['operation'] == 'delete' ? null : operation['value'];

    final response =
        await client!.rpc('upsert_user_state_if_newer', params: {
      'p_user_id': userId,
      'p_key': key,
      'p_value': value,
      'p_updated_at': updatedAt,
      'p_updated_by': _deviceId ?? 'flutter-native',
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
        final localConfirm =
            localStore.read('pace.settings.ai.confirm_actions');
        final localMemory = localStore.read('pace.settings.ai.memory');
        final patch = <String, dynamic>{
          'user_id': user.id,
          if (localConfirm is bool) 'confirm_actions': localConfirm,
          if (localMemory is bool)
            'memory_level': localMemory ? 'limited' : 'none',
        };
        if (patch.length > 1) {
          await client!.from('ai_preferences').upsert(patch);
        }
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
        await localStore.write(
          'pace.settings.ai.confirm_actions',
          remoteConfirm,
          enqueueSync: false,
        );
      }
      if (remoteMemory is String) {
        await localStore.write(
          'pace.settings.ai.memory',
          remoteMemory != 'none',
          enqueueSync: false,
        );
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
      // The auth session may change while the network request is in flight.
      // Never apply a previous account's response to the currently active store.
      if (client?.auth.currentUser?.id != userId) return;
      final row = Map<String, dynamic>.from(raw);
      final key = row['key'] as String;
      final remoteUpdatedAt = row['updated_at'] as String?;
      if (remoteUpdatedAt == null ||
          localStore.pendingOperations().any((op) => op['key'] == key)) {
        continue;
      }

      final localUpdatedAt = localStore.lastSyncedAt(key);
      if (localUpdatedAt != null) {
        final remoteTime = DateTime.tryParse(remoteUpdatedAt);
        final localTime = DateTime.tryParse(localUpdatedAt);
        if (remoteTime != null &&
            localTime != null &&
            !remoteTime.isAfter(localTime)) {
          continue;
        }
      }
      await localStore.applyRemote(key, row['value'], remoteUpdatedAt);
    }
  }
}

/// Prevents delayed Realtime callbacks from an old subscription from
/// applying one account's cloud rows to another account's local store.
bool shouldAcceptRealtimeUserStateForAccount({
  required String? authenticatedUserId,
  required String subscribedUserId,
  required String? activeRealtimeUserId,
}) {
  return authenticatedUserId != null &&
      authenticatedUserId == subscribedUserId &&
      activeRealtimeUserId == subscribedUserId;
}

/// Returns whether a Realtime user_state row is newer than the local
/// checkpoint and safe to apply.
///
/// Pending local mutations always win over a Realtime event. The normal sync
/// cycle will reconcile the cloud state after the local write has completed.
bool shouldApplyRealtimeUserState({
  required DateTime? remoteTime,
  required DateTime? localTime,
  required bool hasPendingMutation,
}) {
  if (hasPendingMutation || remoteTime == null) return false;
  return localTime == null || remoteTime.isAfter(localTime);
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
