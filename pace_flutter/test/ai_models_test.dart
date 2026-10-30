import 'package:flutter_test/flutter_test.dart';
import 'package:pace/features/ai/ai_models.dart';
import 'package:pace/features/ai/ai_service.dart';

void main() {
  test('an empty RLS-filtered delete response never confirms tombstone removal', () {
    expect(
      PaceAiService.deleteResponseConfirmsRemoval(
        rows: const <Map<String, dynamic>>[],
        conversationId: 'conversation-a',
      ),
      isFalse,
    );
    expect(
      PaceAiService.deleteResponseConfirmsRemoval(
        rows: const <Map<String, dynamic>>[
          {'id': 'conversation-b'},
        ],
        conversationId: 'conversation-a',
      ),
      isFalse,
    );
    expect(
      PaceAiService.deleteResponseConfirmsRemoval(
        rows: const <Map<String, dynamic>>[
          {'id': 'conversation-a'},
        ],
        conversationId: 'conversation-a',
      ),
      isTrue,
    );
    expect(
      PaceAiService.deleteResponseConfirmsRemoval(
        rows: const <Map<String, dynamic>>[
          {'id': ''},
        ],
        conversationId: '',
      ),
      isFalse,
    );
  });

  test('native model requests contain only the latest 30 messages', () {
    final now = DateTime.utc(2026, 10, 30);
    final history = List<AiMessage>.generate(
      35,
      (index) => AiMessage(
        id: 'message-$index',
        role: index.isEven ? 'user' : 'assistant',
        text: 'message $index',
        createdAt: now.add(Duration(seconds: index)),
      ),
    );

    final requestWindow = PaceAiService.messagesForModelRequest(history);
    expect(requestWindow, hasLength(30));
    expect(requestWindow.first.id, 'message-5');
    expect(requestWindow.last.id, 'message-34');
    expect(history, hasLength(35));

    final shortHistory = history.take(3).toList();
    expect(
      PaceAiService.messagesForModelRequest(shortHistory).map((item) => item.id),
      ['message-0', 'message-1', 'message-2'],
    );
  });

  test('recent remote window does not re-upload older messages from another device', () {
    final now = DateTime.utc(2026, 10, 30);
    final localHistory = List<AiMessage>.generate(
      35,
      (index) => AiMessage(
        id: 'local-$index',
        role: index.isEven ? 'user' : 'assistant',
        text: 'local $index',
        createdAt: now.add(Duration(seconds: index)),
      ),
    );
    final newerRemote = List<AiMessage>.generate(
      30,
      (index) => AiMessage(
        id: 'remote-$index',
        role: index.isEven ? 'user' : 'assistant',
        text: 'remote $index',
        createdAt: now.add(Duration(seconds: 40 + index)),
      ),
    );

    expect(
      PaceAiService.localMessagesMissingFromRecentRemote(
        localHistory: localHistory,
        remoteRecent: newerRemote,
      ),
      isEmpty,
    );
  });

  test('recent remote overlap still retries missing local messages', () {
    final now = DateTime.utc(2026, 10, 30);
    final localHistory = List<AiMessage>.generate(
      35,
      (index) => AiMessage(
        id: 'local-$index',
        role: index.isEven ? 'user' : 'assistant',
        text: 'local $index',
        createdAt: now.add(Duration(seconds: index)),
      ),
    );
    final remoteRecent = <AiMessage>[
      ...localHistory.take(25),
      ...List<AiMessage>.generate(
        5,
        (index) => AiMessage(
          id: 'remote-$index',
          role: 'assistant',
          text: 'remote $index',
          createdAt: now.add(Duration(seconds: 35 + index)),
        ),
      ),
    ];

    final missing = PaceAiService.localMessagesMissingFromRecentRemote(
      localHistory: localHistory,
      remoteRecent: remoteRecent,
    );

    expect(missing, hasLength(10));
    expect(missing.first.id, 'local-25');
    expect(missing.last.id, 'local-34');
  });

  test('remote messages use model IDs to deduplicate fallback server inserts', () {
    expect(
      PaceAiService.remoteMessageStableId({
        'id': 'server-row-id',
        'model_message_id': 'client-message-id',
      }),
      'client-message-id',
    );
    expect(
      PaceAiService.remoteMessageStableId({
        'id': 'legacy-row-id',
        'model_message_id': null,
      }),
      'legacy-row-id',
    );
    expect(
      PaceAiService.remoteMessageStableId({
        'id': 'legacy-row-id',
        'model_message_id': '',
      }),
      'legacy-row-id',
    );
  });

  test('server row ID and stable model ID merge as one logical message', () {
    final now = DateTime.utc(2026, 10, 30);
    final local = AiMessage(
      id: 'client-message-id',
      role: 'assistant',
      text: 'Réponse locale',
      createdAt: now,
    );
    final remote = AiMessage(
      id: PaceAiService.remoteMessageStableId({
        'id': 'server-row-id',
        'model_message_id': 'client-message-id',
      }),
      role: 'assistant',
      text: 'Réponse distante enrichie',
      createdAt: now,
    );

    final merged = PaceAiService.mergeMessages(
      local: [local],
      remote: [remote],
    );

    expect(merged, hasLength(1));
    expect(merged.single.id, 'client-message-id');
    expect(merged.single.text, 'Réponse locale');
  });

  test('conversation round-trips locally', () {
    final now = DateTime.utc(2026, 8, 15, 12);
    final conversation = AiConversation(
      id: '00000000-0000-4000-8000-000000000001',
      agent: PaceAiAgent.coach,
      title: 'Nutrition',
      updatedAt: now,
      messages: [AiMessage(id: 'm1', role: 'user', text: 'Bonjour', createdAt: now)],
    );

    final restored = AiConversation.fromJson(conversation.toJson());
    expect(restored.id, conversation.id);
    expect(restored.agent, PaceAiAgent.coach);
    expect(restored.title, 'Nutrition');
    expect(restored.messages.single.text, 'Bonjour');
  });

  test('stale remote metadata cannot overwrite a newer offline rename', () {
    final local = AiConversation(
      id: 'conversation-1',
      agent: PaceAiAgent.coach,
      title: 'Titre local récent',
      updatedAt: DateTime.utc(2026, 10, 18, 12),
      messages: [
        AiMessage(
          id: 'message-1',
          role: 'user',
          text: 'message local',
          createdAt: DateTime.utc(2026, 10, 18, 12),
        ),
      ],
    );
    final staleRemote = AiConversation(
      id: 'conversation-1',
      agent: PaceAiAgent.coach,
      title: 'Ancien titre distant',
      updatedAt: DateTime.utc(2026, 10, 18, 11),
    );

    final merged = local.mergeRemoteMetadata(staleRemote);
    expect(merged.title, 'Titre local récent');
    expect(merged.updatedAt, local.updatedAt);
    expect(merged.messages.single.text, 'message local');
  });

  test('newer remote metadata updates the title without discarding local messages', () {
    final local = AiConversation(
      id: 'conversation-1',
      agent: PaceAiAgent.coach,
      title: 'Ancien titre local',
      updatedAt: DateTime.utc(2026, 10, 18, 11),
      messages: [
        AiMessage(
          id: 'message-1',
          role: 'user',
          text: 'message local',
          createdAt: DateTime.utc(2026, 10, 18, 11),
        ),
      ],
    );
    final newerRemote = AiConversation(
      id: 'conversation-1',
      agent: PaceAiAgent.coach,
      title: 'Titre distant récent',
      updatedAt: DateTime.utc(2026, 10, 18, 12),
    );

    final merged = local.mergeRemoteMetadata(newerRemote);
    expect(merged.title, 'Titre distant récent');
    expect(merged.updatedAt, newerRemote.updatedAt);
    expect(merged.messages.single.text, 'message local');
  });

  test('malformed messages field falls back to an empty message list', () {
    final conversation = AiConversation.fromJson(<String, dynamic>{
      'id': 'recovered-conversation',
      'agent': 'coach',
      'title': 'Recovered',
      'updatedAt': '2026-10-18T10:00:00Z',
      'messages': 'not-a-list',
    });

    expect(conversation.id, 'recovered-conversation');
    expect(conversation.messages, isEmpty);
  });

  test('invalid conversation timestamp uses epoch and cannot beat valid remote metadata', () {
    final local = AiConversation.fromJson(<String, dynamic>{
      'id': 'conversation-1',
      'agent': 'coach',
      'title': 'Possibly stale local title',
      'updatedAt': '2026-13-45T99:99:99Z',
    });
    final remote = AiConversation(
      id: 'conversation-1',
      agent: PaceAiAgent.coach,
      title: 'Valid remote title',
      updatedAt: DateTime.utc(2026, 10, 18),
    );

    expect(local.updatedAt.millisecondsSinceEpoch, 0);
    final merged = local.mergeRemoteMetadata(remote);
    expect(merged.title, 'Valid remote title');
    expect(merged.updatedAt, remote.updatedAt);
  });

  test('rejects local timestamps with precision beyond microseconds', () {
    final conversation = AiConversation.fromJson(<String, dynamic>{
      'id': 'conversation-precision',
      'agent': 'coach',
      'title': 'Invalid precision',
      'updatedAt': '2026-10-18T10:00:00.1234567Z',
    });

    expect(conversation.updatedAt.millisecondsSinceEpoch, 0);
  });

  test('invalid message and memory timestamps use safe fallbacks', () {
    final message = AiMessage.fromJson(<String, dynamic>{
      'id': 'message-1',
      'role': 'user',
      'text': 'hello',
      'createdAt': 'not-a-timestamp',
    });
    final memory = AiMemoryItem.fromJson(<String, dynamic>{
      'id': 'memory-1',
      'text': 'memory',
      'createdAt': 'not-a-timestamp',
      'updatedAt': 'also-invalid',
    });

    expect(message.createdAt.millisecondsSinceEpoch, 0);
    expect(memory.createdAt.millisecondsSinceEpoch, 0);
    expect(memory.updatedAt, isNull);
  });

  test('ephemeral conversation is explicitly marked and serializable', () {
    final conversation = AiConversation(
      id: 'ephemeral-1',
      agent: PaceAiAgent.coach,
      title: 'Chat éphémère',
      updatedAt: DateTime.now(),
      ephemeral: true,
    );
    expect(AiConversation.fromJson(conversation.toJson()).ephemeral, isTrue);
  });

  test('memory serializes its lifecycle timestamps', () {
    final created = DateTime.utc(2026, 8, 15);
    final updated = DateTime.utc(2026, 8, 16);
    final item = AiMemoryItem(id: 'memory-1', text: 'Je préfère un suivi simple.', createdAt: created, updatedAt: updated);
    final restored = AiMemoryItem.fromJson(item.toJson());
    expect(restored.id, 'memory-1');
    expect(restored.text, 'Je préfère un suivi simple.');
    expect(restored.updatedAt, updated.toLocal());
  });
}
