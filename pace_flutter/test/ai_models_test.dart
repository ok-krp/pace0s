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
