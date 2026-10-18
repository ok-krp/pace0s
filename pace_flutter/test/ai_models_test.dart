import 'package:flutter_test/flutter_test.dart';
import 'package:pace/features/ai/ai_models.dart';

void main() {
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
