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
    debugPrint('nutrition-stage: account B food persisted');
    expect(store.activeUserId, 'user-b');

    // Verify durable isolation by opening each account file independently.
    // Switching the same LocalStore repeatedly after widget interactions mixes
    // the widget test's fake-async zone with its queued filesystem flushes;
    // independent readers test the on-disk contract without that unrelated
    // scheduling dependency.
    final accountA = await tester.runAsync(() async {
      final reopened = await LocalStore.open(directory: directory);
      await reopened.activateAccount('user-a');
      return reopened;
    });
    if (accountA == null) throw StateError('Could not reopen account A');
    stores.add(accountA);
    expect(accountA.read('pace.nutrition.items'), isNull);

    final accountB = await tester.runAsync(() async {
      final reopened = await LocalStore.open(directory: directory);
      await reopened.activateAccount('user-b');
      return reopened;
    });
    if (accountB == null) throw StateError('Could not reopen account B');
    stores.add(accountB);
    final restored = accountB.read('pace.nutrition.items') as Map;
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
