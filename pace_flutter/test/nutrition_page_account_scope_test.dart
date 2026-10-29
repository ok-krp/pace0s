import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pace/core/storage/local_store.dart';
import 'package:pace/features/nutrition/nutrition_page.dart';

void main() {
  testWidgets(
    'nutrition edits stay with the account that opened the dialog',
    (tester) async {
    final directory = await tester.runAsync(
      () => Directory.systemTemp.createTemp('pace-nutrition-account-'),
    );
    if (directory == null) throw StateError('Could not create test directory');
    debugPrint('nutrition-stage: temp directory created');
    final stores = <LocalStore>[];
    final store = await tester.runAsync(() => LocalStore.open(directory: directory));
    if (store == null) throw StateError('Could not open test local store');
    stores.add(store);
    debugPrint('nutrition-stage: store opened');
    addTearDown(() async {
      for (final openedStore in stores) {
        openedStore.dispose();
      }
      await tester.runAsync(() => directory.delete(recursive: true));
    });

    await tester.runAsync(() => store.activateAccount('user-a'));
    debugPrint('nutrition-stage: switched back to A');
    debugPrint('nutrition-stage: account A activated');
    await tester.pumpWidget(MaterialApp(home: NutritionPage(localStore: store)));
    debugPrint('nutrition-stage: widget pumped');

    // A dialog opened for account A must not write its contents into account B
    // if sign-out/sign-in happens before the user submits it.
    await tester.tap(find.byTooltip('Ajouter un aliment'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.enterText(find.byType(TextField).at(0), 'A-private food');
    await tester.enterText(find.byType(TextField).at(1), '80');
    debugPrint('nutrition-stage: dialog A filled');

    await tester.runAsync(() => store.activateAccount('user-b'));
    debugPrint('nutrition-stage: switched back to B');
    debugPrint('nutrition-stage: account B activated');
    // Do not pump the underlying page while its modal route is still active.
    // Submit against the captured A scope first; the page refreshes after the
    // dialog closes and then exposes the B form.
    await tester.tap(find.widgetWithText(FilledButton, 'Ajouter'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(store.read('pace.nutrition.items'), isNull);
    debugPrint('nutrition-stage: stale account write rejected');

    // A fresh dialog for account B remains writable after the account change.
    await tester.tap(find.byTooltip('Ajouter un aliment'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.enterText(find.byType(TextField).at(0), 'B food');
    await tester.enterText(find.byType(TextField).at(1), '120');
    debugPrint('nutrition-stage: dialog B filled');
    await tester.tap(find.widgetWithText(FilledButton, 'Ajouter'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    final raw = store.read('pace.nutrition.items');
    expect(raw, isA<Map>());
    final entries = (raw as Map).values
        .whereType<List>()
        .expand((items) => items)
        .whereType<Map>()
        .toList();
    expect(entries, hasLength(1));
    expect(entries.single['name'], 'B food');
    debugPrint('nutrition-stage: account B food visible in active scope');
    expect(store.activeUserId, 'user-b');

    // Durable file-level isolation is covered separately by LocalStore tests.
    // This widget test focuses on rejecting the stale A dialog and accepting B.
    },
    timeout: const Timeout(Duration(seconds: 45)),
  );

  testWidgets(
    'nutrition entries remain available after an offline guest store is reopened',
    (tester) async {
      final directory = await tester.runAsync(
        () => Directory.systemTemp.createTemp('pace-nutrition-offline-'),
      );
      if (directory == null) throw StateError('Could not create test directory');

      final stores = <LocalStore>[];
      addTearDown(() async {
        for (final openedStore in stores) {
          openedStore.dispose();
        }
        await tester.runAsync(() => directory.delete(recursive: true));
      });

      final store = await tester.runAsync(
        () => LocalStore.open(directory: directory),
      );
      if (store == null) throw StateError('Could not open guest local store');
      stores.add(store);
      expect(store.activeUserId, isNull);

      await tester.pumpWidget(
        MaterialApp(home: NutritionPage(localStore: store)),
      );
      await tester.tap(find.byTooltip('Ajouter un aliment'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.enterText(find.byType(TextField).at(0), 'Offline oats');
      await tester.enterText(find.byType(TextField).at(1), '80');
      await tester.tap(find.widgetWithText(FilledButton, 'Ajouter'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      expect(find.text('Offline oats'), findsOneWidget);
      expect(find.text('80.0 kcal'), findsOneWidget);
      expect(store.activeUserId, isNull);

      // Reopen the same guest file to prove the journal was flushed to disk,
      // not merely kept in the widget's in-memory state.
      await tester.pumpWidget(const MaterialApp(home: SizedBox.shrink()));
      final reopenedStore = await tester.runAsync(
        () => LocalStore.open(directory: directory),
      );
      if (reopenedStore == null) {
        throw StateError('Could not reopen guest local store');
      }
      stores.add(reopenedStore);
      expect(reopenedStore.activeUserId, isNull);

      // Signing in must select an independent file, not import the guest
      // nutrition journal into the authenticated account.
      await tester.runAsync(() async {
        await reopenedStore.activateAccount('user-a');
        expect(reopenedStore.activeUserId, 'user-a');
        expect(reopenedStore.read('pace.nutrition.items'), isNull);
        await reopenedStore.activateAccount(null);
      });
      expect(reopenedStore.read('pace.nutrition.items'), isA<Map>());

      await tester.pumpWidget(
        MaterialApp(home: NutritionPage(localStore: reopenedStore)),
      );
      expect(find.text('Offline oats'), findsOneWidget);
      expect(find.text('80.0 kcal'), findsOneWidget);
    },
    timeout: const Timeout(Duration(seconds: 45)),
  );
}
