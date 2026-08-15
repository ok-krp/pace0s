import 'package:flutter/material.dart';

import 'app/pace_app.dart';
import 'core/storage/local_store.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final localStore = await LocalStore.open();
  runApp(PaceApp(localStore: localStore));
}
