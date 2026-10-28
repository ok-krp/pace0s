import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pace/core/storage/local_store.dart';
import 'package:pace/features/shopping/shopping_page.dart';

void main() {
  testWidgets(
    'shopping form opened by account A cannot write into account B',
    (tester) async {
      final directory = await tester.runAsync(
        () => Directory.systemTemp.createTemp('pace-shopping-account-'),
      );
      if (directory == null) {
        throw StateError('Could not create test directory');
      }

      final store = await tester.runAsync(
        () => LocalStore.open(directory: directory),
      );
      if (store == null) throw StateError('Could not open local store');

      addTearDown(() async {
        store.dispose();
        await tester.runAsync(() => directory.delete(recursive: true));
      });

      await tester.runAsync(() => store.activateAccount('user-a'));
      await tester.pumpWidget(
        MaterialApp(home: ShoppingPage(localStore: store)),
      );

      await tester.tap(find.byIcon(Icons.add));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).at(0), 'A-private item');
      await tester.enterText(find.byType(TextField).at(1), '2');

      // Keep the route mounted to simulate a delayed async form completing
      // after the LocalStore account scope has changed.
      await tester.runAsync(() => store.activateAccount('user-b'));
      await tester.pump();

      await tester.tap(find.widgetWithText(FilledButton, 'Ajouter'));
      await tester.pumpAndSettle();

      expect(store.activeUserId, 'user-b');
      expect(store.read('pace.shopping'), isNull);

      // A fresh operation started after the scope notification uses B.
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
