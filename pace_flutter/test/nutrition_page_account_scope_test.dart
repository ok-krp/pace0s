import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pace/core/storage/local_store.dart';
import 'package:pace/features/nutrition/nutrition_page.dart';

void main() {
  testWidgets(
    'nutrition edits stay with the account that opened the dialog',
    (tester) async {
    final directory = await Directory.systemTemp.createTemp('pace-nutrition-account-');
    final store = await LocalStore.open(directory: directory);
    addTearDown(() async {
      store.dispose();
      await directory.delete(recursive: true);
    });

    await store.activateAccount('user-a');
    await tester.pumpWidget(MaterialApp(home: NutritionPage(localStore: store)));

    // A dialog opened for account A must not write its contents into account B
    // if sign-out/sign-in happens before the user submits it.
    await tester.tap(find.byTooltip('Ajouter un aliment'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.enterText(find.byType(TextField).at(0), 'A-private food');
    await tester.enterText(find.byType(TextField).at(1), '80');

    await store.activateAccount('user-b');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(find.widgetWithText(FilledButton, 'Ajouter'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(store.read('pace.nutrition.items'), isNull);

    // A fresh dialog for account B remains writable after the account change.
    await tester.tap(find.byTooltip('Ajouter un aliment'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.enterText(find.byType(TextField).at(0), 'B food');
    await tester.enterText(find.byType(TextField).at(1), '120');
    await tester.tap(find.widgetWithText(FilledButton, 'Ajouter'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

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

    await store.activateAccount('user-a');
    expect(store.read('pace.nutrition.items'), isNull);
    await store.activateAccount('user-b');
    final restored = store.read('pace.nutrition.items') as Map;
      expect(
        restored.values
            .whereType<List>()
            .expand((items) => items)
            .whereType<Map>()
            .single['name'],
        'B food',
      );
    },
    timeout: const Timeout(Duration(seconds: 45)),
  );
}
