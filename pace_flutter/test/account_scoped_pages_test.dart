import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pace/core/storage/local_store.dart';
import 'package:pace/features/shopping/shopping_page.dart';

void main() {
  late Directory directory;
  late LocalStore store;

  setUp(() async {
    directory = await Directory.systemTemp.createTemp('pace-shopping-account-');
    store = await LocalStore.open(directory: directory);
  });

  tearDown(() async {
    store.dispose();
    if (await directory.exists()) await directory.delete(recursive: true);
  });

  testWidgets(
    'shopping form opened by account A cannot write into account B',
    (tester) async {
      await store.activateAccount('user-a');
      await tester.pumpWidget(
        MaterialApp(home: ShoppingPage(localStore: store)),
      );

      await tester.tap(find.byIcon(Icons.add));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).at(0), 'A-private item');
      await tester.enterText(find.byType(TextField).at(1), '2');

      // The page remains mounted as a direct account-scope regression test.
      // Real auth navigation also removes routes before changing the store.
      await tester.runAsync(() => store.activateAccount('user-b'));
      await tester.pump();

      await tester.tap(find.widgetWithText(FilledButton, 'Ajouter'));
      await tester.pumpAndSettle();

      expect(store.activeUserId, 'user-b');
      expect(store.read('pace.shopping'), isNull);

      // A new operation after the scope notification should use account B.
      await tester.tap(find.byIcon(Icons.add));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).at(0), 'B-only item');
      await tester.enterText(find.byType(TextField).at(1), '1');
      await tester.tap(find.widgetWithText(FilledButton, 'Ajouter'));
      await tester.pumpAndSettle();

      final items = store.read('pace.shopping') as List;
      expect(items, hasLength(1));
      expect(items.single['name'], 'B-only item');
    },
    timeout: const Timeout(Duration(seconds: 45)),
  );
}
