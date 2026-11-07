import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pace/core/storage/local_store.dart';
import 'package:pace/core/supabase/pace_supabase.dart';
import 'package:pace/core/sync/sync_service.dart';
import 'package:pace/features/ai/ai_models.dart';
import 'package:pace/features/ai/ai_page.dart';
import 'package:pace/features/ai/ai_service.dart';

void main() {
  testWidgets(
    'AI page clears guest transcript immediately when account scope changes',
    (tester) async {
      final directory = await tester.runAsync(
        () => Directory.systemTemp.createTemp('pace-ai-page-scope-'),
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

      final createdAt = DateTime.utc(2026, 10, 28, 10);
      final conversation = AiConversation(
        id: 'guest-conversation',
        agent: PaceAiAgent.coach,
        title: 'Guest chat',
        updatedAt: createdAt,
        messages: [
          AiMessage(
            id: 'guest-message',
            role: 'assistant',
            text: 'A secret transcript for guest',
            createdAt: createdAt,
          ),
        ],
      );
      await tester.runAsync(
        () => store.write(
          'pace.ai.conversations',
          [conversation.toJson()],
          enqueueSync: false,
        ),
      );

      await tester.pumpWidget(
        MaterialApp(
          home: AiPage(
            localStore: store,
            auth: const PaceAuthService(null),
            sync: SyncService(localStore: store, client: null),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('A secret transcript for guest'), findsOneWidget);

      // Keep the route mounted to verify its own scope listener clears PII even
      // if an auth/navigation transition has not removed the route yet.
      await tester.runAsync(() => store.activateAccount('user-b'));
      await tester.pump();

      expect(find.text('A secret transcript for guest'), findsNothing);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    },
    timeout: const Timeout(Duration(seconds: 45)),
  );

  testWidgets(
    'AI memory route invalidates old account controls and content after switch',
    (tester) async {
      final directory = await tester.runAsync(
        () => Directory.systemTemp.createTemp('pace-ai-memory-scope-'),
      );
      if (directory == null) throw StateError('Could not create test directory');
      final store = await tester.runAsync(
        () => LocalStore.open(directory: directory),
      );
      if (store == null) throw StateError('Could not open local store');
      addTearDown(() async {
        store.dispose();
        await tester.runAsync(() => directory.delete(recursive: true));
      });

      await tester.runAsync(() async {
        await store.writeBatchForAccount(
          null,
          writes: {
            'pace.settings.ai.memory': true,
            'pace.ai.memory': [
              {
                'id': 'guest-memory',
                'text': 'Guest-only private memory',
                'createdAt': DateTime.utc(2026, 10, 28).toIso8601String(),
              },
            ],
          },
          enqueueSync: false,
        );
      });
      final auth = const PaceAuthService(null);
      final service = PaceAiService(
        localStore: store,
        auth: auth,
        sync: SyncService(localStore: store, client: null),
      );
      await tester.pumpWidget(
        MaterialApp(home: AiMemoryPage(service: service)),
      );
      await tester.pumpAndSettle();
      expect(find.text('Guest-only private memory'), findsOneWidget);
      expect(find.text('Ajouter un souvenir'), findsOneWidget);

      await tester.runAsync(() => store.activateAccount('user-b'));
      await tester.pump();

      expect(find.text('Guest-only private memory'), findsNothing);
      expect(find.text('Ajouter un souvenir'), findsNothing);
      expect(
        find.textContaining('Le compte a changé'),
        findsOneWidget,
      );
    },
    timeout: const Timeout(Duration(seconds: 45)),
  );
}
