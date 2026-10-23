import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pace/app/pace_app.dart';
import 'package:pace/core/storage/local_store.dart';
import 'package:pace/core/supabase/pace_supabase.dart';
import 'package:pace/core/sync/sync_service.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

void main() {
  testWidgets(
    'offline mode can return to the auth screen without a session',
    (tester) async {
      final directory =
          await Directory.systemTemp.createTemp('pace-offline-exit-');
      print('offline-stage: temp directory created');
      final store = await LocalStore.open(directory: directory);
      print('offline-stage: store opened');
      print('offline-stage: before client');
      final client = SupabaseClient(
        'https://pace-offline-test.supabase.co',
        'test-anon-key',
      );
      addTearDown(() async {
        store.dispose();
        client.dispose();
        await directory.delete(recursive: true);
      });

      print('offline-stage: before pumpWidget');
      await tester.pumpWidget(
        MaterialApp(
          home: PaceApp(
            localStore: store,
            auth: PaceAuthService(client),
            sync: SyncService(localStore: store, client: null),
          ),
        ),
      );

      final offlineButton = find.text('Continuer hors connexion');
      expect(offlineButton, findsOneWidget);
      print('offline-stage: auth screen shown');
      await tester.tap(offlineButton);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      print('offline-stage: local shell shown');

      // The shell's exit action is in the Plus section, not on the initial tab.
      await tester.tap(find.text('Plus'));
      await tester.pump();
      expect(find.text('Revenir à la connexion'), findsOneWidget);
      print('offline-stage: exit button shown');

      await tester.tap(find.text('Revenir à la connexion'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.text('Se connecter'), findsOneWidget);
      expect(find.text('Continuer hors connexion'), findsOneWidget);
      print('offline-stage: returned to auth');
    },
    timeout: const Timeout(Duration(seconds: 45)),
  );
}
