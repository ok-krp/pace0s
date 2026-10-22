import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pace/core/storage/local_store.dart';
import 'package:pace/features/nutrition/nutrition_page.dart';

void main() {
  testWidgets('nutrition writes follow the active account after account switch', (tester) async {
    final directory = await Directory.systemTemp.createTemp('pace-nutrition-account-');
    final store = await LocalStore.open(directory: directory);
    addTearDown(() async {
      store.dispose();
      await directory.delete(recursive: true);
    });

    await store.activateAccount('user-a');
    await tester.pumpWidget(MaterialApp(home: NutritionPage(localStore: store)));

    await store.activateAccount('user-b');
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('Ajouter un aliment'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).at(0), 'Pomme');
    await tester.enterText(find.byType(TextField).at(1), '80');
    await tester.tap(find.widgetWithText(FilledButton, 'Ajouter'));
    await tester.pumpAndSettle();

    final raw = store.read('pace.nutrition.items');
    expect(raw, isA<Map>());
    final entries = (raw as Map).values
        .whereType<List>()
        .expand((items) => items)
        .whereType<Map>()
        .toList();
    expect(entries, hasLength(1));
    expect(entries.single['name'], 'Pomme');
    expect(store.activeUserId, 'user-b');

    await store.activateAccount('user-a');
    expect(store.read('pace.nutrition.items'), isNull);
    await store.activateAccount('user-b');
    final restored = store.read('pace.nutrition.items') as Map;
    expect(
      restored.values.whereType<List>().expand((items) => items).whereType<Map>().single['name'],
      'Pomme',
    );
  });
}
