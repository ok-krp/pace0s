import 'package:flutter/material.dart';

import 'app/pace_app.dart';
import 'core/notifications/notification_service.dart';
import 'core/storage/local_store.dart';
import 'core/supabase/pace_supabase.dart';
import 'core/sync/sync_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Local state is opened first so the native UI can start even with no
  // network connection. Supabase is only the optional cloud/auth layer.
  final localStore = await LocalStore.open();
  try {
    await PaceSupabase.initialize();
  } catch (_) {
    // Missing configuration or an unavailable cloud must never prevent the
    // native application from starting offline.
  }

  final auth = PaceAuthService(PaceSupabase.client);
  final sync = SyncService(localStore: localStore, client: PaceSupabase.client);
  try {
    await PaceNotificationService.instance.initialize();
  } catch (_) {
    // Notifications are optional and must never block offline application startup.
  }
  runApp(PaceApp(localStore: localStore, auth: auth, sync: sync));
}
