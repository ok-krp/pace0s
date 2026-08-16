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
