import 'package:supabase_flutter/supabase_flutter.dart';

import '../storage/local_store.dart';

/// Replays local mutations through Pace's existing user_state RPC. The local
/// store remains authoritative while offline; queued mutations are removed
/// only after the remote operation is accepted.
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
          final accepted = await _push(operation);
          if (accepted) {
            await localStore.acknowledgeOperation(operation);
          } else {
            break;
          }
        } catch (_) {
          break;
        }
      }
    } finally {
      _running = false;
    }
  }

  Future<bool> _push(Map<String, dynamic> operation) async {
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

    // The existing web sync contract returns true when this mutation wins and
    // false when the server already contains a newer version.
    return response == true;
  }
}
