import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../storage/local_store.dart';

/// Replays local mutations through Pace's existing user_state RPC and pulls
/// newer remote state. Local writes remain durable while offline.
class SyncService {
  SyncService({required this.localStore, required this.client});

  final LocalStore localStore;
  final SupabaseClient? client;
  bool _running = false;
  bool _syncRequested = false;
  bool? _cloudSyncConsent;
  String? _cloudSyncConsentUserId;
  DateTime? _cloudSyncConsentCheckedAt;
  DateTime? _lastNutritionReconciledAt;
  static const _cloudSyncConsentCacheTtl = Duration(seconds: 30);
  static const _nutritionFallbackInterval = Duration(minutes: 1);
  RealtimeChannel? _realtimeChannel;
  String? _realtimeUserId;

  Future<bool> _hasCloudSyncConsent(String userId) async {
    if (localStore.currentAccountId != userId ||
        client?.auth.currentUser?.id != userId) {
      return false;
    }
    final now = DateTime.now();
    if (_cloudSyncConsentUserId == userId &&
        _cloudSyncConsentCheckedAt != null &&
        now.difference(_cloudSyncConsentCheckedAt!) < _cloudSyncConsentCacheTtl) {
      return _cloudSyncConsent == true;
    }

    try {
      final rows = await client!
          .from('consent_records')
          .select('granted')
          .eq('user_id', userId)
          .eq('consent_type', 'sync_cloud')
          .order('created_at', ascending: false)
          .limit(1);
      _cloudSyncConsentUserId = userId;
      _cloudSyncConsent = rows.isNotEmpty && rows.first['granted'] == true;
      _cloudSyncConsentCheckedAt = now;
      return _cloudSyncConsent!;
    } catch (_) {
      // Fail closed if consent cannot be confirmed. Local outbox entries remain.
      _cloudSyncConsentUserId = userId;
      _cloudSyncConsent = null;
      _cloudSyncConsentCheckedAt = now;
      return false;
    }
  }

  bool _hasCachedCloudSyncConsent(String userId) =>
      _cloudSyncConsentUserId == userId && _cloudSyncConsent == true;

  Future<void> onAccountChanged(String? userId) async {
    if (_realtimeUserId != userId) {
      final channel = _realtimeChannel;
      _realtimeChannel = null;
      _realtimeUserId = null;
      if (channel != null && client != null) {
        await client!.removeChannel(channel);
      }
    }
    if (_cloudSyncConsentUserId != userId) {
      _cloudSyncConsentUserId = null;
      _cloudSyncConsent = null;
      _cloudSyncConsentCheckedAt = null;
    }
    _lastNutritionReconciledAt = null;
    _syncRequested = false;
  }

  bool get cloudSyncConsentGranted =>
      _cloudSyncConsentUserId == client?.auth.currentUser?.id &&
      _cloudSyncConsent == true;

  bool get cloudSyncConsentDenied =>
      _cloudSyncConsentUserId == client?.auth.currentUser?.id &&
      _cloudSyncConsent == false;

  Future<void> setCloudSyncConsent(bool granted) async {
    final userId = client?.auth.currentUser?.id;
    if (userId == null || localStore.currentAccountId != userId) return;
    _cloudSyncConsentUserId = userId;
    _cloudSyncConsent = granted;
    _cloudSyncConsentCheckedAt = DateTime.now();
    if (!granted) {
      final channel = _realtimeChannel;
      _realtimeChannel = null;
      _realtimeUserId = null;
      if (channel != null) await client!.removeChannel(channel);
    }
  }

  Future<void> syncNow() async {
    final initialUserId = client?.auth.currentUser?.id;
    if (client == null || initialUserId == null) return;
    if (!shouldRunCloudSync(
      userId: initialUserId,
      activeAccountId: localStore.currentAccountId,
      consentGranted: await _hasCloudSyncConsent(initialUserId),
    )) {
      final channel = _realtimeChannel;
      _realtimeChannel = null;
      _realtimeUserId = null;
      if (channel != null) await client!.removeChannel(channel);
      return;
    }
    if (client?.auth.currentUser?.id != initialUserId ||
        localStore.currentAccountId != initialUserId) {
      return;
    }
    if (_running) {
      // Coalesce writes that arrive during an active network cycle instead
      // of silently dropping their immediate-sync request.
      _syncRequested = true;
      return;
    }

    _running = true;
    try {
      do {
        _syncRequested = false;
        final user = client?.auth.currentUser;
        if (user == null ||
            user.id != initialUserId ||
            localStore.currentAccountId != initialUserId ||
            !_hasCachedCloudSyncConsent(initialUserId)) {
          break;
        }

        await _ensureRealtimeSubscription(user.id);
        final hadNutritionMutation = localStore.pendingOperations().any(
          (operation) => operation['key'] == 'pace.nutrition.items',
        );
        final hadLocalAiPreferenceMutation = localStore.pendingOperations().any(
          (operation) =>
              operation['key'] == 'pace.settings.ai.confirm_actions' ||
              operation['key'] == 'pace.settings.ai.memory',
        );
        final shouldReconcileNutrition = hadNutritionMutation ||
            _lastNutritionReconciledAt == null ||
            DateTime.now().difference(_lastNutritionReconciledAt!) >=
                _nutritionFallbackInterval;
        await _pushPending();
        await _syncAiPreferences(pushLocal: hadLocalAiPreferenceMutation);
        await _pullRemote();
        if (shouldReconcileNutrition) {
          final reconciled = await _reconcileNutritionProjection(user.id);
          if (reconciled) _lastNutritionReconciledAt = DateTime.now();
          if (hadNutritionMutation ||
              localStore.pendingOperations().any(
                (operation) => operation['key'] == 'pace.nutrition.items',
              )) {
            await _pushPending();
          }
        }
      } while (_syncRequested && client?.auth.currentUser?.id == initialUserId);
    } finally {
      _running = false;
    }
  }

  Future<void> _ensureRealtimeSubscription(String userId) async {
    if (client?.auth.currentUser?.id != userId ||
        localStore.currentAccountId != userId ||
        !_hasCachedCloudSyncConsent(userId)) {
      return;
    }
    if (_realtimeUserId == userId && _realtimeChannel != null) return;

    if (_realtimeChannel != null) {
      await client!.removeChannel(_realtimeChannel!);
      _realtimeChannel = null;
      _realtimeUserId = null;
    }

    final channel = client!.channel('pace-flutter-user-state-$userId');

    void handlePayload(PostgresChangePayload payload) {
      // P1.1 deliberately handles INSERT/UPDATE only. DELETE/tombstone
      // semantics are implemented in P1.3 so a DELETE can never be mistaken
      // for an empty user_state value here.
      final record = Map<String, dynamic>.from(payload.newRecord);
      final key = record['key'];
      final value = record['value'];
      final updatedAt = record['updated_at'];
      if (key is! String || updatedAt is! String) return;
      unawaited(_applyRealtimeRow(key, value, updatedAt));
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
        )
        .onPostgresChanges(
          event: PostgresChangeEvent.insert,
          schema: 'public',
          table: 'food_log',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'user_id',
            value: userId,
          ),
          callback: (_) => unawaited(_handleFoodLogRealtime(userId)),
        )
        .onPostgresChanges(
          event: PostgresChangeEvent.update,
          schema: 'public',
          table: 'food_log',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'user_id',
            value: userId,
          ),
          callback: (_) => unawaited(_handleFoodLogRealtime(userId)),
        );

    _realtimeChannel = channel;
    _realtimeUserId = userId;

    try {
      channel.subscribe((status, error) {
        switch (status) {
          case RealtimeSubscribeStatus.subscribed:
            // Reconcile immediately after the websocket is confirmed. This
            // closes the race where an event was emitted before subscription
            // became active.
            unawaited(syncNow());
            break;
          case RealtimeSubscribeStatus.channelError:
          case RealtimeSubscribeStatus.timedOut:
          case RealtimeSubscribeStatus.closed:
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
      // Polling remains the fallback when Realtime is unavailable.
    }
  }

  Future<void> _applyRealtimeRow(
    String key,
    dynamic value,
    String updatedAt,
  ) async {
    final userId = client?.auth.currentUser?.id;
    if (userId == null ||
        localStore.currentAccountId != userId ||
        _cloudSyncConsentUserId != userId ||
        _cloudSyncConsent != true) {
      return;
    }
    if (_running) {
      // The regular sync cycle will reconcile this row after its current
      // mutation batch completes, preventing a transient overwrite.
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
    final userId = client?.auth.currentUser?.id;
    if (userId == null ||
        localStore.currentAccountId != userId ||
        client?.auth.currentUser?.id != userId ||
        !_hasCachedCloudSyncConsent(userId)) return;
    for (final operation in List<Map<String, dynamic>>.from(
      localStore.pendingOperations(),
    )) {
      if (client?.auth.currentUser?.id != userId ||
          localStore.currentAccountId != userId ||
          !_hasCachedCloudSyncConsent(userId)) {
        return;
      }
      try {
        final result = await _push(operation);
        if (!shouldAcknowledgeSyncOperation(accepted: result.accepted)) {
          // A rejected mutation is not an acknowledgement. Keep the durable
          // local outbox entry and skip remote hydration for this key in
          // _pullRemote; the next sync cycle can retry against server time.
          // Never replace a pending local user edit with a remote snapshot.
          continue;
        }
        // The request may finish after an auth event switches the active
        // namespace. Acknowledge only the original owner's saved outbox;
        // never mutate the newly active account's queue or sync metadata.
        await localStore.acknowledgeOperationForAccount(
          userId,
          operation,
          result.serverUpdatedAt ?? DateTime.now().toUtc().toIso8601String(),
        );
        if (client?.auth.currentUser?.id != userId ||
            localStore.currentAccountId != userId) {
          return;
        }
      } catch (_) {
        // Preserve the operation for the next reconnect/retry.
        break;
      }
    }
  }

  Future<_PushResult> _push(Map<String, dynamic> operation) async {
    final userId = client!.auth.currentUser!.id;
    if (localStore.currentAccountId != userId) {
      throw StateError('Espace local différent du compte authentifié.');
    }
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
      'p_updated_by': 'flutter-native',
    });

    final write = CloudSyncWriteResponse.fromRpc(response);
    if (write.accepted) {
      return _PushResult.accepted(write.updatedAt);
    }

    // The RPC already reports rejection and the authoritative timestamp.
    // Do not fetch/apply remote state here: the local outbox remains canonical
    // until the retry is accepted or an explicit conflict workflow is added.
    return const _PushResult.rejected();
  }

  Future<void> _syncAiPreferences({required bool pushLocal}) async {
    final user = client!.auth.currentUser;
    if (user == null ||
        localStore.currentAccountId != user.id ||
        client?.auth.currentUser?.id != user.id ||
        !_hasCachedCloudSyncConsent(user.id)) return;

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

  Future<void> _handleFoodLogRealtime(String userId) async {
    if (client?.auth.currentUser?.id != userId ||
        localStore.currentAccountId != userId ||
        !_hasCachedCloudSyncConsent(userId)) {
      return;
    }
    final reconciled = await _reconcileNutritionProjection(userId);
    if (!reconciled) return;
    _lastNutritionReconciledAt = DateTime.now();
    if (localStore.pendingOperations().any(
      (operation) => operation['key'] == 'pace.nutrition.items',
    )) {
      await syncNow();
    }
  }

  Future<bool> _reconcileNutritionProjection(String userId) async {
    if (localStore.currentAccountId != userId ||
        client?.auth.currentUser?.id != userId ||
        !_hasCachedCloudSyncConsent(userId)) return false;
    try {
      final now = DateTime.now();
      final day =
          '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
      final raw = localStore.read('pace.nutrition.items');
      final itemsByDay =
          Map<String, dynamic>.from(raw is Map ? raw : <String, dynamic>{});
      final currentDay = itemsByDay[day] is List
          ? List<dynamic>.from(itemsByDay[day] as List)
          : <dynamic>[];

      // Retry pending native inserts with their stable UUID. Upsert makes a
      // lost HTTP response safe: the same local operation cannot create a
      // duplicate food_log row on the next reconnect.
      for (final rawItem in currentDay.whereType<Map>()) {
        final item = Map<String, dynamic>.from(rawItem);
        if (item['pendingFoodLog'] != true || !_isFoodLogUuid(item['id'])) {
          continue;
        }
        try {
          await upsertNutritionFoodLogItem(
            id: item['id'] as String,
            logDate: day,
            name: item['name']?.toString() ?? 'Aliment',
            meal: item['meal']?.toString() ?? 'Repas',
            kcal: _numberOrZero(item['kcal']),
            proteinG: _numberOrZero(item['p']),
            carbsG: _numberOrZero(item['c']),
            fatG: _numberOrZero(item['f']),
            fiberG: _numberOrZero(item['fiber']),
            sugarG: _numberOrZero(item['sugar']),
            sodiumMg: _numberOrZero(item['sodium']),
          );
        } catch (_) {
          // Keep the durable local meal and retry on the next cycle.
        }
      }

      final rows = await client!
          .from('food_log')
          .select('id,name,meal,kcal,protein_g,carbs_g,fat_g,fiber_g,sugar_g,sodium_mg')
          .eq('user_id', userId)
          .eq('log_date', day)
          .order('created_at');

      final legacyRows = currentDay
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .where((item) => !_isFoodLogUuid(item['id']))
          .toList();

      final canonicalRows = rows.map((row) => <String, dynamic>{
            'id': row['id'],
            'name': row['name'],
            'meal': row['meal'],
            'kcal': (row['kcal'] as num?)?.toDouble() ?? 0,
            'p': (row['protein_g'] as num?)?.toDouble() ?? 0,
            'c': (row['carbs_g'] as num?)?.toDouble() ?? 0,
            'f': (row['fat_g'] as num?)?.toDouble() ?? 0,
            'fiber': (row['fiber_g'] as num?)?.toDouble() ?? 0,
            'sugar': (row['sugar_g'] as num?)?.toDouble() ?? 0,
            'sodium': (row['sodium_mg'] as num?)?.toDouble() ?? 0,
            'qty': 1,
          }).toList();
      final canonicalIds =
          canonicalRows.map((item) => item['id'] as String).toSet();
      final pendingRows = currentDay
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .where((item) =>
              item['pendingFoodLog'] == true &&
              _isFoodLogUuid(item['id']) &&
              !canonicalIds.contains(item['id']))
          .toList();
      final nextRows = [
        ...canonicalRows,
        ...legacyRows.where((item) => !canonicalIds.contains(item['id'])),
        ...pendingRows.where((item) => !canonicalIds.contains(item['id'])),
      ];

      if (client?.auth.currentUser?.id != userId ||
          localStore.currentAccountId != userId) {
        return false;
      }
      if (jsonEncode(currentDay) != jsonEncode(nextRows)) {
        itemsByDay[day] = nextRows;
        await localStore.write('pace.nutrition.items', itemsByDay);

        final rawTotals = localStore.read('pace.nutrition.totals');
        final totals =
            Map<String, dynamic>.from(rawTotals is Map ? rawTotals : <String, dynamic>{});
        double sum(String key) => nextRows.fold<double>(
              0,
              (total, item) => total +
                  ((item is Map && item[key] is num)
                      ? (item[key] as num).toDouble()
                      : 0),
            );
        totals[day] = {
          'kcal': sum('kcal'),
          'p': sum('p'),
          'c': sum('c'),
          'f': sum('f'),
        };
        await localStore.write('pace.nutrition.totals', totals);
      }
      return true;
    } catch (_) {
      // Keep the local snapshot and its outbox intact if food_log is offline.
      return false;
    }
  }

  Future<void> upsertNutritionFoodLogItem({
    required String id,
    required String logDate,
    required String name,
    required String meal,
    required double kcal,
    required double proteinG,
    required double carbsG,
    required double fatG,
    required double fiberG,
    required double sugarG,
    required double sodiumMg,
  }) async {
    final user = client?.auth.currentUser;
    if (client == null || user == null ||
        localStore.currentAccountId != user.id) {
      throw StateError('Session ou espace local utilisateur indisponible.');
    }
    await client!.from('food_log').upsert({
      'id': id,
      'user_id': user.id,
      'log_date': logDate,
      'meal': meal,
      'name': name,
      'kcal': kcal,
      'protein_g': proteinG,
      'carbs_g': carbsG,
      'fat_g': fatG,
      'fiber_g': fiberG,
      'sugar_g': sugarG,
      'sodium_mg': sodiumMg,
      'source': 'manual',
      'meta': <String, dynamic>{'native_manual': true},
    }, onConflict: 'id');
  }

  Future<void> deleteNutritionFoodLogItem(String id) async {
    if (!_isFoodLogUuid(id)) return;
    final user = client?.auth.currentUser;
    if (client == null || user == null ||
        localStore.currentAccountId != user.id) {
      throw StateError('Session ou espace local utilisateur indisponible.');
    }
    await client!
        .from('food_log')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);
  }

  Future<void> _pullRemote() async {
    final userId = client!.auth.currentUser!.id;
    if (localStore.currentAccountId != userId ||
        client?.auth.currentUser?.id != userId ||
        !_hasCachedCloudSyncConsent(userId)) return;
    final rows = await client!
        .from('user_state')
        .select('key,value,updated_at')
        .eq('user_id', userId);

    for (final raw in rows) {
      if (client?.auth.currentUser?.id != userId ||
          localStore.currentAccountId != userId) {
        return;
      }
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

double _numberOrZero(dynamic value) =>
    value is num ? value.toDouble() : 0;

String newFoodLogUuid() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}';
}

bool _isFoodLogUuid(dynamic id) {
  if (id is! String) return false;
  final parts = id.split('-');
  return parts.length == 5 &&
      parts[0].length == 8 &&
      parts[1].length == 4 &&
      parts[2].length == 4 &&
      parts[3].length == 4 &&
      parts[4].length == 12;
}

bool shouldAcknowledgeSyncOperation({required bool accepted}) => accepted;

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
  const _PushResult.accepted(this.serverUpdatedAt) : accepted = true;

  const _PushResult.rejected()
      : accepted = false,
        serverUpdatedAt = null;

  final bool accepted;
  final String? serverUpdatedAt;
}
, caseSensitive: false).hasMatch(id);

/// Native and web clients share the same explicit sync_cloud opt-in.
bool shouldRunCloudSync({
  required String? userId,
  required String? activeAccountId,
  required bool consentGranted,
}) =>
    userId != null && activeAccountId == userId && consentGranted;

/// A local outbox operation is acknowledged only after server acceptance.
bool shouldAcknowledgeSyncOperation({required bool accepted}) => accepted;

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
  const _PushResult.accepted(this.serverUpdatedAt) : accepted = true;

  const _PushResult.rejected()
      : accepted = false,
        serverUpdatedAt = null;

  final bool accepted;
  final String? serverUpdatedAt;
}
