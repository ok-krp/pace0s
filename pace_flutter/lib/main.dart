import 'dart:async';

import 'package:flutter/material.dart';

import 'app/pace_app.dart';
import 'core/storage/local_store.dart';
import 'core/supabase/pace_supabase.dart';
import 'core/sync/sync_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Local state is opened first so the native UI can start even with no
  // network connection. Supabase is optional at process start and is only the
  // cloud/authentication layer.
  final localStore = await LocalStore.open();
  SupabaseClientBootstrap clientBootstrap;
  try {
    clientBootstrap = SupabaseClientBootstrap(await PaceSupabase.initialize());
  } catch (_) {
    clientBootstrap = const SupabaseClientBootstrap(null);
  }

  final auth = PaceAuthService(clientBootstrap.client);
  final sync = SyncService(localStore: localStore, client: clientBootstrap.client);
  runApp(PaceApp(localStore: localStore, auth: auth, sync: sync));
}

class SupabaseClientBootstrap {
  const SupabaseClientBootstrap(this.client);
  final dynamic client;
}
