import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pace/core/storage/local_store.dart';
import 'package:pace/core/supabase/pace_supabase.dart';
import 'package:pace/core/sync/sync_service.dart';
import 'package:pace/features/more/more_page.dart';

void main() {
  testWidgets(
    'configured local-only shell can return to authentication without a session',
    (tester) async {
      final directory =
          await Directory.systemTemp.createTemp('pace-offline-exit-');
      final store = await LocalStore.open(directory: directory);
      addTearDown(() async {
        store.dispose();
        await directory.delete(recursive: true);
      });
      var exitedOffline = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: MorePage(
              localStore: store,
              auth: const PaceAuthService(null),
              sync: SyncService(localStore: store, client: null),
              offlineMode: true,
              themeMode: ThemeMode.system,
              onThemeChanged: (_) {},
              onExitOffline: () => exitedOffline = true,
            ),
          ),
        ),
      );

      final exitButton = find.text('Revenir à la connexion');
      expect(exitButton, findsOneWidget);
      await tester.tap(exitButton);
      await tester.pump();
      expect(exitedOffline, isTrue);
    },
    timeout: const Timeout(Duration(seconds: 45)),
  );
}
