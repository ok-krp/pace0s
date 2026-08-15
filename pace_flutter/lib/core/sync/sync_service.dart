import 'dart:async';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../storage/local_store.dart';

/// Replays local mutations when a Supabase session is available. The local
/// store remains authoritative while offline; acknowledged mutations are
/// removed from the outbox only after the remote write succeeds.
class SyncService {
  SyncService({required this.localStore, required this.client});

  final LocalStore localStore;
  final SupabaseClient? client;
  bool _running = false;

  Future<void> syncNow() async {
    if (_running || client == null || client!.auth.currentUser == null) return;
    _running = true;
    try {
      for (final operation in List<Map<String, dynamic>>.from(localStore.pendingOperations())) {
        try {
          await _push(operation);
          await localStore.acknowledgeOperation(operation);
        } catch (_) {
          // Keep the operation queued. A later reconnect/retry will replay it.
          break;
        }
      }
    } finally {
      _running = false;
    }
  }

  Future<void> _push(Map<String, dynamic> operation) async {
    final userId = client!.auth.currentUser!.id;
    final key = operation['key'] as String;
    final payload = <String, dynamic>{
      'user_id': userId,
      'key': key,
      'value': operation['value'],
      'operation': operation['operation'],
      'queued_at': operation['queuedAt'],
    };

    // The native migration writes through the same generic synchronization
    // contract used by Pace's existing cloud sync layer.
    await client!.from('pace_sync_queue').upsert(
      payload,
      onConflict: 'user_id,key',
    );
  }
}
