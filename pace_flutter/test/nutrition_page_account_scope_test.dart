import 'dart:io';

import 'package:material_ui/material_ui.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pace/core/storage/local_store.dart';
import 'package:pace/core/sync/food_log_sync.dart';
import 'package:pace/core/sync/sync_service.dart';
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

    await tester.runAsync(() => store.activateAccount('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
    await tester.pumpWidget(MaterialApp(home: NutritionPage(localStore: store, sync: SyncService(localStore: store, client: null))));

    // A dialog opened for account A must not write its contents into account B
    // if sign-out/sign-in happens before the user submits it.
    await tester.tap(find.byTooltip('Ajouter un aliment'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.enterText(find.byType(TextField).at(0), 'A-private food');
    await tester.enterText(find.byType(TextField).at(1), '80');

    await tester.runAsync(() => store.activateAccount('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
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

    final outbox = store.read(FoodLogSync.outboxKey) as List;
    expect(outbox, hasLength(1));
    final queuedRow = (outbox.single as Map)['row'] as Map;
    expect(queuedRow['fiber_g'], isNull);
    expect(queuedRow['sugar_g'], isNull);
    expect(queuedRow['sodium_mg'], isNull);
    final missing = (queuedRow['meta'] as Map)['missing_nutrients'] as List;
    expect(missing, containsAll(['fiber_g', 'sugar_g', 'sodium_mg']));

    expect(store.activeUserId, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

    // Durable file-level isolation is covered separately by LocalStore tests.
    // This widget test focuses on rejecting the stale A dialog and accepting B.
    },
    timeout: const Timeout(Duration(seconds: 45)),
  );

  testWidgets(
    'outbox capacity error does not persist an item or drop pending operations',
    (tester) async {
      final directory = await tester.runAsync(
        () => Directory.systemTemp.createTemp('pace-nutrition-outbox-full-'),
      );
      if (directory == null) throw StateError('Could not create test directory');
      final store = await tester.runAsync(
        () => LocalStore.open(directory: directory),
      );
      if (store == null) throw StateError('Could not open test local store');
      addTearDown(() async {
        store.dispose();
        await tester.runAsync(() => directory.delete(recursive: true));
      });

      const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      final pending = List<dynamic>.generate(
        FoodLogSync.maximumPendingOperations,
        (index) => <String, dynamic>{
          'id':
              '00000000-0000-4000-8000-${(index + 1).toString().padLeft(12, '0')}',
          'operation': 'delete',
          'queuedAt': '2026-11-06T12:00:00.000Z',
        },
      );
      await tester.runAsync(() async {
        await store.activateAccount(userId);
        await store.writeBatchForAccount(
          userId,
          writes: {FoodLogSync.outboxKey: pending},
          localOnlyKeys: const {FoodLogSync.outboxKey},
          enqueueSync: false,
          notify: false,
        );
      });

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: NutritionPage(
              localStore: store,
              sync: SyncService(localStore: store, client: null),
            ),
          ),
        ),
      );
      await tester.tap(find.byTooltip('Ajouter un aliment'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.enterText(find.byType(TextField).at(0), 'Not queued food');
      await tester.enterText(find.byType(TextField).at(1), '90');
      await tester.tap(find.widgetWithText(FilledButton, 'Ajouter'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      expect(find.textContaining('2000 opérations'), findsOneWidget);
      expect(store.read(FoodLogSync.outboxKey), hasLength(2000));
      expect(store.read('pace.nutrition.items'), isNull);
      expect(store.activeUserId, userId);
    },
    timeout: const Timeout(Duration(seconds: 45)),
  );

  testWidgets(
    'guest can add nutrition while offline using the local store',
    (tester) async {
      final directory = await tester.runAsync(
        () => Directory.systemTemp.createTemp('pace-nutrition-guest-'),
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

      expect(store.activeUserId, isNull);
      await tester.pumpWidget(
        MaterialApp(home: NutritionPage(localStore: store, sync: SyncService(localStore: store, client: null))),
      );
      await tester.tap(find.byTooltip('Ajouter un aliment'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await tester.enterText(find.byType(TextField).at(0), 'Offline oats');
      await tester.enterText(find.byType(TextField).at(1), '80');
      await tester.tap(find.widgetWithText(FilledButton, 'Ajouter'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      expect(store.activeUserId, isNull);
      final raw = store.read('pace.nutrition.items');
      expect(raw, isA<Map>());
      final entries = (raw as Map).values
          .whereType<List>()
          .expand((items) => items)
          .whereType<Map>()
          .toList();
      expect(entries, hasLength(1));
      expect(entries.single['name'], 'Offline oats');
      expect(entries.single['kcal'], 80.0);
      expect(store.read('pace.nutrition.totals'), isA<Map>());
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
        MaterialApp(home: NutritionPage(localStore: store, sync: SyncService(localStore: store, client: null))),
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
