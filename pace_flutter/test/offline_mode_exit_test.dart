import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

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
      final localStore = await LocalStore.open(directory: directory);
      final client = SupabaseClient('https://example.supabase.co', 'test-key');
      var exitedOffline = false;

      try {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: MorePage(
                localStore: localStore,
                auth: PaceAuthService(client),
                sync: SyncService(localStore: localStore, client: client),
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
        expect(exitedOffline, isTrue);
      } finally {
        client.dispose();
        await directory.delete(recursive: true);
      }
    },
  );
}
