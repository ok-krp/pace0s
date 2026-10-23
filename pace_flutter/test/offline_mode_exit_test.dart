import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pace/app/pace_app.dart';
import 'package:pace/core/storage/local_store.dart';
import 'package:pace/core/supabase/pace_supabase.dart';
import 'package:pace/core/sync/sync_service.dart';

void main() {
  testWidgets(
    'offline mode can return to the auth screen without a session',
    (tester) async {
      final directory = await tester.runAsync(
        () => Directory.systemTemp.createTemp('pace-offline-exit-'),
      );
      if (directory == null) throw StateError('Could not create test directory');
      debugPrint('offline-stage: temp directory created');
      final store = await tester.runAsync(() => LocalStore.open(directory: directory));
      if (store == null) throw StateError('Could not open test local store');
      debugPrint('offline-stage: store opened');
      addTearDown(() async {
        store.dispose();
        await tester.runAsync(() => directory.delete(recursive: true));
      });

      debugPrint('offline-stage: before pumpWidget');
      await tester.pumpWidget(
        MaterialApp(
          home: PaceApp(
            localStore: store,
            auth: const PaceAuthService(null),
            sync: SyncService(localStore: store, client: null),
          ),
        ),
      );

      final offlineButton = find.text('Continuer hors connexion');
      expect(offlineButton, findsOneWidget);
      debugPrint('offline-stage: auth screen shown');
      await tester.tap(offlineButton);
      // _continueOffline performs file I/O before publishing the shell. Let
      // that real asynchronous work finish outside the fake-async test zone.
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      debugPrint('offline-stage: local shell shown');

      // The shell's exit action is in the Plus section, not on the initial tab.
      final navigationBar = find.byType(NavigationBar);
      expect(navigationBar, findsOneWidget);
      final navTopLeft = tester.getTopLeft(navigationBar);
      final navSize = tester.getSize(navigationBar);
      await tester.tapAt(
        navTopLeft + Offset(navSize.width * 0.9, navSize.height * 0.5),
      );
      await tester.pump();
      expect(find.text('Revenir à la connexion'), findsOneWidget);
      debugPrint('offline-stage: exit button shown');

      await tester.tap(find.text('Revenir à la connexion'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.text('Se connecter'), findsOneWidget);
      expect(find.text('Continuer hors connexion'), findsOneWidget);
      debugPrint('offline-stage: returned to auth');
    },
    timeout: const Timeout(Duration(seconds: 45)),
  );
}
