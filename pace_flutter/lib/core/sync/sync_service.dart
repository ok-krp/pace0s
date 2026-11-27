import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../compliance/compliance_service.dart';
import '../storage/local_store.dart';

/// Replays local mutations through Pace's existing user_state RPC and pulls
/// newer remote state. Local writes remain durable while offline.
class SyncService {
  SyncService({required this.localStore, required this.client}) {
    localStore.addMutationListener(_onLocalMutation);
  }

  /// Fire-and-forget entry point for automatic sync triggers. UI callers
  /// may still await syncNow() for feedback; background triggers must not leak
  /// transient network/disk failures as uncaught async errors.
  void _scheduleSync() {
    unawaited(syncNow().catchError((Object _) {}));
  }

  void _scheduleNutritionRealtime(String userId) {
    unawaited(_handleFoodLogRealtime(userId).catchError((Object _) {}));
  }

  /// A durable local write should start its sync cycle immediately. Device-only
  /// keys stay local and must not trigger a network reconciliation.
  void _onLocalMutation(String key) {
    final userId = client?.auth.currentUser?.id;
    if (userId == null || localStore.currentAccountId != userId) return;
    if (!SyncService.isSyncableKey(key)) {
      final obsolete = localStore.pendingOperations()
          .where((operation) => operation['key'] == key)
          .toList();
      for (final operation in obsolete) {
        unawaited(localStore.discardOperationForAccount(userId, operation).catchError((Object _) {}));
      }
      return;
    }
    _scheduleSync();
  }

  final LocalStore localStore;
  final SupabaseClient? client;
  bool _running = false;
  bool _syncRequested = false;
  bool? _cloudSyncConsent;
  String? _cloudSyncConsentUserId;
  DateTime? _cloudSyncConsentCheckedAt;
  DateTime? _lastNutritionReconciledAt;
  // Serialize native Nutrition projections and explicit deletions. This keeps
  // a query/upsert already in flight from resurrecting a meal after the user
  // has deleted it.
  Future<void> _nutritionMutationQueue = Future<void>.value();
  static const _deletedNutritionIdsKey = 'pace.__sync_food_log_deleted_ids';
  static const _cloudSyncConsentCacheTtl = Duration(seconds: 30);
  static const _nutritionFallbackInterval = Duration(minutes: 1);
  RealtimeChannel? _realtimeChannel;
  String? _realtimeUserId;

  /// Keys that must never be mirrored into user_state.
  /// Device-bound secrets and large AI transcripts remain on this device or in
  /// their dedicated backend tables; they are not generic cross-device state.
  static const Set<String> excludedSyncKeys = {
    'pace.sport.active',
    'pace.ai.conversations',
    'pace.ai.deleted_conversations',
    'pace.finance.pin.hash',
    'pace.ai.debug',
    'pace.billing.device_id',
    'pace.watch.last_metrics',
    'pace.legal.consent',
    'pace.domain.outbox',
  };

  /// Exact canonical, legacy, and domain aliases excluded before PostgREST
  /// returns rows. Derive aliases from one set so pull and Realtime cannot drift.
  static final Set<String> excludedRemotePullKeys = {
    ...excludedSyncKeys,
    ...excludedSyncKeys.map((key) => 'lt.${key.substring(5)}'),
    ...excludedSyncKeys
        .where((key) => !key.startsWith('pace.domain.'))
        .map((key) => 'pace.domain.${key.substring(5)}'),
    ...excludedSyncKeys
        .where((key) => !key.startsWith('pace.domain.'))
        .map((key) => 'lt.domain.${key.substring(5)}'),
    'pace.__sync_food_log_deleted_ids',
    'pace.__sync_food_log_outbox',
    'pace.__sync_food_log_quarantine',
    'pace.__sync_ai_preferences_pending',
    'pace.__sync_last_pull_at',
    'pace.__sync_last_full_pull_at',
  };

  static String get excludedRemotePullKeysFilter {
    final values = excludedRemotePullKeys.map((key) => '"$key"').join(',');
    return '($values)';
  }

  static const List<String> excludedRemotePullKeyPatterns = [
    r'^(pace|lt)\.__',
    r'^(pace|lt)\.domain\.__',
    r'^(pace|lt)\.(privacy|ble|import|local-ai)\.',
    r'^(pace|lt)\.domain\.(privacy|ble|import|local-ai)\.',
    r'^(pace|lt)\.ai\.debug',
    r'^(pace|lt)\.domain\.ai\.debug',
    r'^(pace|lt)\.ai\.pending:',
    r'^(pace|lt)\.domain\.ai\.pending:',
    r'^(pace|lt)\.(finance|ai\.local)\.',
    r'^(pace|lt)\.domain\.(finance|ai\.local)\.',
  ];

  static bool isDeviceLocalKey(String key) {
    final legacyCanonicalKey =
        key.startsWith('lt.') ? 'pace.${key.substring(3)}' : key;
    final domainCanonicalKey = legacyCanonicalKey.startsWith('pace.domain.')
        ? 'pace.${legacyCanonicalKey.substring(12)}'
        : legacyCanonicalKey;
    return legacyCanonicalKey.startsWith('pace.__') ||
        domainCanonicalKey.startsWith('pace.__') ||
        domainCanonicalKey.startsWith('pace.privacy.') ||
        domainCanonicalKey.startsWith('pace.finance.') ||
        domainCanonicalKey.startsWith('pace.ble.') ||
        domainCanonicalKey.startsWith('pace.import.') ||
        domainCanonicalKey.startsWith('pace.local-ai.') ||
        domainCanonicalKey.startsWith('pace.ai.local.') ||
        domainCanonicalKey.startsWith('pace.ai.debug') ||
        domainCanonicalKey.startsWith('pace.ai.pending:') ||
        domainCanonicalKey == 'pace.legal.consent' ||
        excludedSyncKeys.contains(legacyCanonicalKey) ||
        excludedSyncKeys.contains(domainCanonicalKey);
  }

  static bool isSyncableKey(String key) =>
      key.startsWith('pace.') &&
      !key.startsWith('pace.__sync_') &&
      !key.startsWith('pace.__nutrition_cache:') &&
      !isDeviceLocalKey(key);


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
      // The functional sync opt-in lives in legal_consent.opts.sync_cloud.
      // consent_records is intentionally limited to granular health/AI/finance
      // categories and rejects a synthetic "sync_cloud" consent_type.
      final granted = await PaceComplianceService(client).hasConsent('sync_cloud');
      if (localStore.currentAccountId != userId ||
          client?.auth.currentUser?.id != userId) {
        return false;
      }
      _cloudSyncConsentUserId = userId;
      _cloudSyncConsent = granted;
      _cloudSyncConsentCheckedAt = DateTime.now();
      return granted;
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

  Future<T> _serializeNutrition<T>(Future<T> Function() operation) {
    final next = _nutritionMutationQueue.then((_) => operation());
    // A failed operation is reported to its caller, but must not poison the
    // queue and block later explicit deletes or retry projections.
    _nutritionMutationQueue = next.then<void>(
      (_) {},
      onError: (Object _, StackTrace __) {},
    );
    return next;
  }

  Map<String, dynamic> _readNutritionDeletionState(String userId) {
    if (!isCurrentLocalAccount(userId)) {
      return {'ids': <String>{}, 'pending': <String>{}};
    }
    final raw = localStore.read(_deletedNutritionIdsKey);
    if (raw is! Map || raw['userId'] != userId) {
      return {'ids': <String>{}, 'pending': <String>{}};
    }
    Set<String> parse(dynamic value) => value is List
        ? value.whereType<String>().where((id) => id.isNotEmpty).toSet()
        : <String>{};
    return {
      'ids': parse(raw['ids']),
      'pending': parse(raw['pending']),
    };
  }

  Set<String> _readDeletedNutritionIds(String userId) =>
      _readNutritionDeletionState(userId)['ids'] as Set<String>;

  Set<String> _readPendingNutritionDeleteIds(String userId) =>
      _readNutritionDeletionState(userId)['pending'] as Set<String>;

  Future<void> _writeDeletedNutritionIds(
    String userId,
    Set<String> ids, {
    Set<String>? pendingIds,
  }) async {
    if (!isCurrentLocalAccount(userId)) return;
    // Keep every completed tombstone so a stale full-state snapshot can
    // never resurrect an old meal. The metadata is local-only and excluded
    // from user_state; pending SQL deletes are still sent in bounded batches.
    await localStore.write(
      _deletedNutritionIdsKey,
      {
        'userId': userId,
        'ids': ids.toList(),
        'pending': (pendingIds ?? <String>{}).toList(),
      },
      enqueueSync: false,
    );
  }

  bool get cloudSyncConsentGranted =>
      _cloudSyncConsentUserId == client?.auth.currentUser?.id &&
      _cloudSyncConsent == true;

  bool get cloudSyncConsentDenied =>
      _cloudSyncConsentUserId == client?.auth.currentUser?.id &&
      _cloudSyncConsent == false;

  String? get activeAccountId => localStore.currentAccountId;

  bool isCurrentLocalAccount(String? accountId) {
    if (localStore.currentAccountId != accountId) return false;
    if (client == null) return accountId == null;
    return accountId != null && client!.auth.currentUser?.id == accountId;
  }

  Future<void> setCloudSyncConsent(bool granted) async {
    final userId = client?.auth.currentUser?.id;
    if (userId == null || localStore.currentAccountId != userId) return;
    if (_cloudSyncConsentUserId != userId ||
        _cloudSyncConsent != granted) {
      // Reconcile immediately after consent is enabled again so queued
      // Nutrition deletions are not delayed by the ordinary 60s fallback.
      _lastNutritionReconciledAt = null;
    }
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
      final shouldRerunForActiveAccount = _syncRequested;
      _syncRequested = false;
      _running = false;
      // If account B requested sync while account A's in-flight request was
      // draining, immediately start a fresh cycle once B's namespace is active.
      if (shouldRerunForActiveAccount &&
          isCurrentLocalAccount(client?.auth.currentUser?.id)) {
        _scheduleSync();
      }
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

    // A private, low-payload Broadcast announces only the changed key.
    // The client then pulls the authoritative value through the existing
    // account-scoped query, which excludes device-local keys before transfer.
    final channel = client!.channel(
      'pace-user-state:$userId',
      opts: const RealtimeChannelConfig(private: true),
    );

    channel
        .onBroadcast(
          event: 'user_state_changed',
          callback: (payload) {
            if (!isCurrentLocalAccount(userId) ||
                !_hasCachedCloudSyncConsent(userId)) {
              return;
            }
            final nested = payload['payload'];
            final eventPayload = nested is Map ? nested : payload;
            final key = eventPayload['key'];
            if (key is String && SyncService.isSyncableKey(key)) {
              _scheduleSync();
            }
          },
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
          callback: (_) => _scheduleNutritionRealtime(userId),
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
          callback: (_) => _scheduleNutritionRealtime(userId),
        );

    // Supabase Postgres Changes cannot filter DELETE events. RLS is not
    // applied to DELETE payloads, which expose only primary keys when RLS is
    // enabled. Use the bounded 60-second canonical pull to reconcile deletes. 
    _realtimeChannel = channel;
    _realtimeUserId = userId;

    try {
      channel.subscribe((status, error) {
        switch (status) {
          case RealtimeSubscribeStatus.subscribed:
            // Reconcile immediately after the websocket is confirmed. This
            // closes the race where an event was emitted before subscription
            // became active.
            _scheduleSync();
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

  Future<void> _pushPending() async {
    final userId = client?.auth.currentUser?.id;
    if (userId == null ||
        localStore.currentAccountId != userId ||
        client?.auth.currentUser?.id != userId ||
        !_hasCachedCloudSyncConsent(userId)) {
      return;
    }
    for (final operation in List<Map<String, dynamic>>.from(
      localStore.pendingOperations(),
    )) {
      if (client?.auth.currentUser?.id != userId ||
          localStore.currentAccountId != userId ||
          !_hasCachedCloudSyncConsent(userId)) {
        return;
      }
      try {
        final key = operation['key'];
        if (key is! String || !SyncService.isSyncableKey(key)) {
          await localStore.discardOperationForAccount(userId, operation);
          continue;
        }
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

    final write = CloudSyncWriteResponse.fromRpc(response, fallbackUpdatedAt: updatedAt);
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
        !_hasCachedCloudSyncConsent(user.id)) {
      return;
    }

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
      if (!isCurrentLocalAccount(user.id) ||
          !_hasCachedCloudSyncConsent(user.id)) {
        return;
      }
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
      if (!isCurrentLocalAccount(user.id) ||
          !_hasCachedCloudSyncConsent(user.id)) {
        return;
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

  Future<bool> _reconcileNutritionProjection(String userId) =>
      _serializeNutrition(() => _reconcileNutritionProjectionNow(userId));

  Future<bool> _reconcileNutritionProjectionNow(String userId) async {
    if (localStore.currentAccountId != userId ||
        client?.auth.currentUser?.id != userId ||
        !_hasCachedCloudSyncConsent(userId)) {
      return false;
    }
    try {
      final now = DateTime.now();
      final day =
          '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
      final initialRaw = localStore.read('pace.nutrition.items');
      final initialItemsByDay = Map<String, dynamic>.from(
        initialRaw is Map ? initialRaw : <String, dynamic>{},
      );
      final initialCurrentDay = initialItemsByDay[day] is List
          ? List<dynamic>.from(initialItemsByDay[day] as List)
          : <dynamic>[];

      final deletedIds = _readDeletedNutritionIds(userId);

      // Retry pending native inserts using the snapshot present at request
      // start. Deleted IDs are never reinserted, including after an offline
      // deletion whose SQL request has not yet reached the server.
      for (final rawItem in initialCurrentDay.whereType<Map>()) {
        final item = Map<String, dynamic>.from(rawItem);
        if (item['pendingFoodLog'] != true ||
            !_isFoodLogUuid(item['id']) ||
            deletedIds.contains(item['id'])) {
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

      // Retry exact-ID deletes that were retained while offline or while
      // cloud sync consent was disabled. A failed delete remains tombstoned
      // and is filtered from the local projection below.
      final pendingDeleteIds = _readPendingNutritionDeleteIds(userId)
          .where(_isFoodLogUuid)
          .toList();
      if (pendingDeleteIds.isNotEmpty) {
        final deletedIds = _readDeletedNutritionIds(userId);
        final remainingPending = _readPendingNutritionDeleteIds(userId);
        // Keep URL/query payloads bounded even after many offline deletes.
        for (var offset = 0; offset < pendingDeleteIds.length; offset += 100) {
          final batch = pendingDeleteIds.skip(offset).take(100).toList();
          try {
            await client!
                .from('food_log')
                .delete()
                .eq('user_id', userId)
                .inFilter('id', batch);
            if (!isCurrentLocalAccount(userId)) return false;
            remainingPending.removeAll(batch);
            await _writeDeletedNutritionIds(
              userId,
              deletedIds,
              pendingIds: remainingPending,
            );
          } catch (_) {
            // Keep failed and not-yet-attempted batches for the next sync.
            break;
          }
        }
      }

      final rows = await client!
          .from('food_log')
          .select('id,name,meal,kcal,protein_g,carbs_g,fat_g,fiber_g,sugar_g,sodium_mg')
          .eq('user_id', userId)
          .eq('log_date', day)
          .order('created_at');

      if (client?.auth.currentUser?.id != userId ||
          localStore.currentAccountId != userId) {
        return false;
      }

      // The network round-trip above may have overlapped with a manual add or
      // delete. Re-read the latest local snapshot immediately before building
      // the projection so an edit made during the query is never discarded.
      final latestRaw = localStore.read('pace.nutrition.items');
      final latestItemsByDay = Map<String, dynamic>.from(
        latestRaw is Map ? latestRaw : <String, dynamic>{},
      );
      final latestCurrentDay = latestItemsByDay[day] is List
          ? List<dynamic>.from(latestItemsByDay[day] as List)
          : <dynamic>[];

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
      final nextRows = mergeNutritionProjectionRows(
        canonicalRows: canonicalRows,
        latestLocalRows: latestCurrentDay
            .whereType<Map>()
            .map((item) => Map<String, dynamic>.from(item))
            .toList(),
        deletedIds: _readDeletedNutritionIds(userId),
      );

      if (jsonEncode(latestCurrentDay) != jsonEncode(nextRows)) {
        latestItemsByDay[day] = nextRows;
        await localStore.write('pace.nutrition.items', latestItemsByDay);
        if (!isCurrentLocalAccount(userId) ||
            !_hasCachedCloudSyncConsent(userId)) {
          return false;
        }

        final rawTotals = localStore.read('pace.nutrition.totals');
        final totals =
            Map<String, dynamic>.from(rawTotals is Map ? rawTotals : <String, dynamic>{});
        double sum(String key) => nextRows.fold<double>(
              0,
              (total, item) => total +
                  ((item[key] is num)
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
    if (id.isEmpty) return;
    final user = client?.auth.currentUser;
    if (client == null || user == null ||
        localStore.currentAccountId != user.id) {
      throw StateError('Session ou espace local utilisateur indisponible.');
    }

    await _serializeNutrition(() async {
      if (!isCurrentLocalAccount(user.id)) {
        throw StateError('La session a changé avant la suppression Nutrition.');
      }

      // Persist the deletion intent before touching the server. The account-
      // scoped local tombstone prevents stale user_state/food_log snapshots
      // from restoring this meal after an offline delete or account switch.
      final deletedIds = _readDeletedNutritionIds(user.id)..add(id);
      final pendingIds = _readPendingNutritionDeleteIds(user.id);
      if (_isFoodLogUuid(id)) pendingIds.add(id);
      await _writeDeletedNutritionIds(
        user.id,
        deletedIds,
        pendingIds: pendingIds,
      );

      // Legacy timestamp IDs exist only in user_state. They are filtered from
      // future pulls locally; UUID-backed canonical rows are deleted by exact ID.
      if (!_isFoodLogUuid(id) || !_hasCachedCloudSyncConsent(user.id)) return;

      try {
        await client!
            .from('food_log')
            .delete()
            .eq('id', id)
            .eq('user_id', user.id);
        if (isCurrentLocalAccount(user.id)) {
          pendingIds.remove(id);
          await _writeDeletedNutritionIds(
            user.id,
            deletedIds,
            pendingIds: pendingIds,
          );
        }
      } catch (_) {
        // The local delete remains accepted. The durable tombstone is retried
        // during the next consented sync cycle.
      }
    });
  }

  Future<void> _pullRemote() async {
    final userId = client!.auth.currentUser!.id;
    if (localStore.currentAccountId != userId ||
        client?.auth.currentUser?.id != userId ||
        !_hasCachedCloudSyncConsent(userId)) {
      return;
    }
    // user_state.value can contain large Nutrition/Health snapshots. Read
    // the full account once, then only changes since the previous successful
    // pull. A two-minute overlap protects against small clock skew and writes
    // racing a previous request; Realtime remains the primary fast path.
    final previousPullAt =
        localStore.read('__cloud_sync_last_pull_at') as String?;
    final previousPullTime = previousPullAt == null
        ? null
        : DateTime.tryParse(previousPullAt)?.toUtc();
    final requestStartedAt = DateTime.now().toUtc();
    var query = client!
        .from('user_state')
        .select('key,value,updated_at')
        .eq('user_id', userId);
    if (previousPullTime != null) {
      query = query.gt(
        'updated_at',
        previousPullTime
            .subtract(const Duration(minutes: 2))
            .toIso8601String(),
      );
    }
    final rows = await query
        .not('key', 'in', SyncService.excludedRemotePullKeysFilter)
        .not('key', 'match', SyncService.excludedRemotePullKeyPatterns[0])
        .not('key', 'match', SyncService.excludedRemotePullKeyPatterns[1])
        .not('key', 'match', SyncService.excludedRemotePullKeyPatterns[2])
        .not('key', 'match', SyncService.excludedRemotePullKeyPatterns[3]);

    for (final raw in rows) {
      if (client?.auth.currentUser?.id != userId ||
          localStore.currentAccountId != userId) {
        return;
      }
      final row = Map<String, dynamic>.from(raw);
      final key = row['key'] as String;
      if (!SyncService.isSyncableKey(key) ||
          SyncService.excludedRemotePullKeys.contains(key)) {
        continue;
      }
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
      final safeValue = key == 'pace.nutrition.items'
          ? filterDeletedNutritionItems(
              row['value'],
              _readDeletedNutritionIds(userId),
            )
          : row['value'];
      await localStore.applyRemote(key, safeValue, remoteUpdatedAt);
    }
    if (client?.auth.currentUser?.id == userId &&
        localStore.currentAccountId == userId) {
      await localStore.write(
        '__cloud_sync_last_pull_at',
        requestStartedAt.toIso8601String(),
        enqueueSync: false,
      );
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
  return RegExp(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    caseSensitive: false,
  ).hasMatch(id);
}

/// Builds a canonical projection while retaining legacy and not-yet-uploaded
/// local rows from the latest snapshot. A deleted canonical UUID is not kept
/// unless it is still explicitly marked as a pending local insert.
dynamic filterDeletedNutritionItems(
  dynamic value,
  Set<String> deletedIds,
) {
  if (deletedIds.isEmpty || value is! Map) return value;
  return <String, dynamic>{
    for (final entry in value.entries)
      if (entry.key is String)
        entry.key as String: entry.value is List
            ? (entry.value as List)
                .where((item) =>
                    item is! Map ||
                    !deletedIds.contains(item['id']?.toString()))
                .toList()
            : entry.value,
  };
}

List<Map<String, dynamic>> mergeNutritionProjectionRows({
  required List<Map<String, dynamic>> canonicalRows,
  required List<Map<String, dynamic>> latestLocalRows,
  Set<String> deletedIds = const <String>{},
}) {
  final canonicalIds =
      canonicalRows.map((item) => item['id'] as String).toSet();
  final legacyRows = latestLocalRows
      .where((item) =>
          !_isFoodLogUuid(item['id']) &&
          !deletedIds.contains(item['id']?.toString()))
      .toList();
  final pendingRows = latestLocalRows
      .where((item) =>
          item['pendingFoodLog'] == true &&
          _isFoodLogUuid(item['id']) &&
          !deletedIds.contains(item['id']?.toString()) &&
          !canonicalIds.contains(item['id']))
      .toList();
  return [
    ...canonicalRows.where(
      (item) => !deletedIds.contains(item['id']?.toString()),
    ),
    ...legacyRows.where((item) => !canonicalIds.contains(item['id'])),
    ...pendingRows.where((item) => !canonicalIds.contains(item['id'])),
  ];
}

/// Native and web clients share the same explicit sync_cloud opt-in.
bool shouldRunCloudSync({
  required String? userId,
  required String? activeAccountId,
  required bool consentGranted,
}) =>
    userId != null && activeAccountId == userId && consentGranted;

/// A local outbox operation is acknowledged only after server acceptance.
bool shouldAcknowledgeSyncOperation({required bool accepted}) => accepted;

/// Validated response contract returned by upsert_user_state_if_newer().
class CloudSyncWriteResponse {
  const CloudSyncWriteResponse({
    required this.accepted,
    required this.updatedAt,
  });

  final bool accepted;
  final String updatedAt;

  factory CloudSyncWriteResponse.fromRpc(
    dynamic response, {
    String? fallbackUpdatedAt,
  }) {
    if (response is bool) {
      if (fallbackUpdatedAt == null || fallbackUpdatedAt.isEmpty) {
        throw const FormatException('invalid cloud sync write response');
      }
      return CloudSyncWriteResponse(
        accepted: response,
        updatedAt: fallbackUpdatedAt,
      );
    }
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
