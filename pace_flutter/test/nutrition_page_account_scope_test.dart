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
    final stores = <LocalStore>[];
    final store = await tester.runAsync(() => LocalStore.open(directory: directory));
    if (store == null) throw StateError('Could not open test local store');
    stores.add(store);
    addTearDown(() async {
      for (final openedStore in stores) {
        openedStore.dispose();
      }
      await tester.runAsync(() => directory.delete(recursive: true));
    });

    await tester.runAsync(() => store.activateAccount('user-a'));
    await tester.pumpWidget(MaterialApp(home: NutritionPage(localStore: store)));

    // A dialog opened for account A must not write its contents into account B
    // if sign-out/sign-in happens before the user submits it.
    await tester.tap(find.byTooltip('Ajouter un aliment'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.enterText(find.byType(TextField).at(0), 'A-private food');
    await tester.enterText(find.byType(TextField).at(1), '80');

    await tester.runAsync(() => store.activateAccount('user-b'));
    // Do not pump the underlying page while its modal route is still active.
    // Submit against the captured A scope first; the page refreshes after the
    // dialog closes and then exposes the B form.
    await tester.tap(find.widgetWithText(FilledButton, 'Ajouter'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(store.read('pace.nutrition.items'), isNull);

    // A fresh dialog for account B remains writable after the account change.
    await tester.tap(find.byTooltip('Ajouter un aliment'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.enterText(find.byType(TextField).at(0), 'B food');
    await tester.enterText(find.byType(TextField).at(1), '120');
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
    expect(store.activeUserId, 'user-b');

    // Durable file-level isolation is covered separately by LocalStore tests.
    // This widget test focuses on rejecting the stale A dialog and accepting B.
    },
    timeout: const Timeout(Duration(seconds: 45)),
  );

  testWidgets(
    'nutrition rejects malformed numeric input without saving',
    (tester) async {
      final directory = await tester.runAsync(
        () => Directory.systemTemp.createTemp('pace-nutrition-invalid-'),
      );
      if (directory == null) throw StateError('Could not create test directory');

      final store = await tester.runAsync(
        () => LocalStore.open(directory: directory),
      );
      if (store == null) throw StateError('Could not open guest local store');
      addTearDown(() async {
        store.dispose();
        await tester.runAsync(() => directory.delete(recursive: true));
      });

      await tester.pumpWidget(
        MaterialApp(home: NutritionPage(localStore: store)),
      );
      await tester.tap(find.byTooltip('Ajouter un aliment'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.enterText(find.byType(TextField).at(0), 'Invalid oats');
      await tester.enterText(find.byType(TextField).at(1), 'eighty');
      await tester.tap(find.widgetWithText(FilledButton, 'Ajouter'));
      await tester.pump();

      expect(find.text('Ajouter un aliment'), findsOneWidget);
      expect(store.read('pace.nutrition.items'), isNull);

      await tester.tap(find.widgetWithText(TextButton, 'Annuler'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      // Let the dialog's async cleanup finish before the test teardown uses
      // runAsync for temporary-directory cleanup.
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 350)),
      );
      await tester.pump();
      await tester.pumpWidget(const MaterialApp(home: SizedBox.shrink()));
    },
    timeout: const Timeout(Duration(seconds: 45)),
  );


}
