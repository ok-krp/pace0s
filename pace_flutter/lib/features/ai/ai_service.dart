import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/storage/local_store.dart';
import '../../core/supabase/pace_supabase.dart';
import '../../core/sync/sync_service.dart';
import 'ai_models.dart';

/// Native AI data/service boundary. Conversations and memory are kept locally
/// first; the existing Pace AI HTTP endpoint is used only for model inference.
/// It is never used to render the Pace UI.
class PaceAiService {
  PaceAiService({required this.localStore, required this.sync, required this.auth});

  final LocalStore localStore;
  final SyncService sync;
  final PaceAuthService auth;

  static const _conversationKey = 'pace.ai.conversations';
  static const _memoryKey = 'pace.ai.memory';
  static const _memoryEnabledKey = 'pace.settings.ai.memory';
  static const _confirmKey = 'pace.settings.ai.confirm_actions';
  static const _aiUrl = String.fromEnvironment(
    'PACE_AI_URL',
    defaultValue: 'https://pace0s.lovable.app/api/ai-chat',
  );

  SupabaseClient? get _client => auth.client;

  bool get memoryEnabled => localStore.read(_memoryEnabledKey) as bool? ?? true;
  bool get confirmActions => localStore.read(_confirmKey) as bool? ?? true;

  Future<void> setMemoryEnabled(bool enabled) async {
    await localStore.write(_memoryEnabledKey, enabled);
    if (!enabled) await localStore.write(_memoryKey, <dynamic>[]);
    unawaited(sync.syncNow());
  }

  Future<void> setConfirmActions(bool enabled) async {
    await localStore.write(_confirmKey, enabled);
    unawaited(sync.syncNow());
    final client = _client;
    final user = auth.currentUser;
    if (client != null && user != null) {
      await client.from('ai_preferences').upsert({
        'user_id': user.id,
        'confirm_actions': enabled,
      });
    }
  }

  List<AiConversation> loadLocalConversations() {
    final raw = localStore.read(_conversationKey);
    if (raw is! List) return const <AiConversation>[];
    return raw
        .whereType<Map>()
        .map((value) => AiConversation.fromJson(Map<String, dynamic>.from(value)))
        .where((conversation) => !conversation.ephemeral)
        .toList()
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
  }

  Future<List<AiConversation>> loadConversations({PaceAiAgent agent = PaceAiAgent.coach}) async {
    final local = loadLocalConversations().where((item) => item.agent == agent).toList();
    final client = _client;
    final user = auth.currentUser;
    if (client == null || user == null) return local;

    try {
      final rows = await client
          .from('ai_conversations')
          .select('id,agent_type,title,is_starred,is_archived,is_ephemeral,updated_at')
          .eq('user_id', user.id)
          .eq('agent_type', agent.name)
          .eq('is_ephemeral', false)
          .order('updated_at', ascending: false);
      final remote = rows.whereType<Map>().map((row) {
        final value = Map<String, dynamic>.from(row);
        return AiConversation(
          id: value['id']?.toString() ?? '',
          agent: agent,
          title: value['title']?.toString() ?? 'Nouvelle conversation',
          updatedAt: DateTime.tryParse(value['updated_at']?.toString() ?? '')?.toLocal() ?? DateTime.now(),
        );
      }).toList();
      final merged = <String, AiConversation>{for (final item in local) item.id: item};
      for (final item in remote) merged[item.id] = (merged[item.id] ?? item).copyWith(title: item.title, updatedAt: item.updatedAt);
      final result = merged.values.where((item) => item.agent == agent).toList()..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
      await _saveLocalConversations(result);
      return result;
    } catch (_) {
      return local;
    }
  }

  Future<AiConversation> createConversation({PaceAiAgent agent = PaceAiAgent.coach, bool ephemeral = false}) async {
    final now = DateTime.now();
    final conversation = AiConversation(
      id: _uuid(),
      agent: agent,
      title: ephemeral ? 'Chat éphémère' : 'Nouvelle conversation',
      updatedAt: now,
      ephemeral: ephemeral,
    );
    if (!ephemeral) {
      final conversations = loadLocalConversations()..insert(0, conversation);
      await _saveLocalConversations(conversations);
      final client = _client;
      final user = auth.currentUser;
      if (client != null && user != null) {
        try {
          await client.from('ai_conversations').insert({
            'id': conversation.id,
            'user_id': user.id,
            'agent_type': agent.name,
            'title': conversation.title,
            'is_ephemeral': false,
          });
        } catch (_) {
          // Local conversation remains valid and will be retried by a later sync.
        }
      }
    }
    return conversation;
  }

  Future<void> renameConversation(String id, String title) async {
    final clean = title.trim().replaceAll(RegExp(r'\s+'), ' ').substring(0, min(80, title.trim().replaceAll(RegExp(r'\s+'), ' ').length));
    final conversations = loadLocalConversations();
    final index = conversations.indexWhere((item) => item.id == id);
    if (index >= 0) {
      conversations[index] = conversations[index].copyWith(title: clean.isEmpty ? 'Nouvelle conversation' : clean, updatedAt: DateTime.now());
      await _saveLocalConversations(conversations);
    }
    final client = _client;
    final user = auth.currentUser;
    if (client != null && user != null) {
      await client.from('ai_conversations').update({'title': clean.isEmpty ? 'Nouvelle conversation' : clean}).eq('id', id).eq('user_id', user.id);
    }
  }

  Future<void> deleteConversation(String id) async {
    final conversations = loadLocalConversations()..removeWhere((item) => item.id == id);
    await _saveLocalConversations(conversations);
    final client = _client;
    final user = auth.currentUser;
    if (client != null && user != null) {
      await client.from('ai_conversations').delete().eq('id', id).eq('user_id', user.id);
    }
  }

  Future<List<AiMessage>> loadMessages(String id) async {
    final local = loadLocalConversations().firstWhere(
      (item) => item.id == id,
      orElse: () => const AiConversation(id: '', agent: PaceAiAgent.coach, title: '', updatedAt: DateTime.fromMillisecondsSinceEpoch(0)),
    );
    if (local.id.isNotEmpty && local.messages.isNotEmpty) return local.messages;
    final client = _client;
    final user = auth.currentUser;
    if (client == null || user == null) return local.messages;
    try {
      final rows = await client.from('ai_messages').select('id,role,plain_text,created_at').eq('conversation_id', id).eq('user_id', user.id).order('created_at');
      final messages = rows.whereType<Map>().map((row) => AiMessage(
            id: row['id']?.toString() ?? _uuid(),
            role: row['role']?.toString() ?? 'assistant',
            text: row['plain_text']?.toString() ?? '',
            createdAt: DateTime.tryParse(row['created_at']?.toString() ?? '')?.toLocal() ?? DateTime.now(),
          )).toList();
      await _replaceMessages(id, messages);
      return messages;
    } catch (_) {
      return local.messages;
    }
  }

  Future<String> send({required AiConversation conversation, required String text}) async {
    final clean = text.trim();
    if (clean.isEmpty) return '';
    final now = DateTime.now();
    final userMessage = AiMessage(id: _uuid(), role: 'user', text: clean, createdAt: now);
    final previous = await loadMessages(conversation.id);
    final next = [...previous, userMessage];
    if (!conversation.ephemeral) await _replaceMessages(conversation.id, next);
    await _insertCloudMessage(conversation, userMessage);

    final responseText = await _requestModel(conversation: conversation, messages: next);
    final assistant = AiMessage(id: _uuid(), role: 'assistant', text: responseText, createdAt: DateTime.now());
    if (!conversation.ephemeral) {
      await _replaceMessages(conversation.id, [...next, assistant]);
      await _insertCloudMessage(conversation, assistant);
      if (conversation.title == 'Nouvelle conversation') {
        await renameConversation(conversation.id, clean.length > 52 ? '${clean.substring(0, 52).trim()}…' : clean);
      }
    }
    return responseText;
  }

  Future<String> _requestModel({required AiConversation conversation, required List<AiMessage> messages}) async {
    final token = _client?.auth.currentSession?.accessToken;
    if (token == null || token.isEmpty) {
      throw StateError('Connectez-vous à Pace pour utiliser l’IA.');
    }
    final payload = <String, dynamic>{
      'conversationId': conversation.id,
      'agentType': conversation.agent.name,
      'ephemeral': conversation.ephemeral,
      'messages': messages
          .map((message) => {
                'id': message.id,
                'role': message.role,
                'parts': [
                  {'type': 'text', 'text': message.text}
                ],
              })
          .toList(),
    };
    final response = await http.post(
      Uri.parse(_aiUrl),
      headers: {'Authorization': 'Bearer $token', 'Content-Type': 'application/json', 'Accept': 'text/plain'},
      body: jsonEncode(payload),
    ).timeout(const Duration(minutes: 2));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError(response.body.isEmpty ? 'Le service IA a refusé la requête (${response.statusCode}).' : response.body);
    }
    return _parseAiStream(response.body);
  }

  String _parseAiStream(String body) {
    final output = StringBuffer();
    for (final raw in const LineSplitter().convert(body)) {
      var line = raw.trim();
      if (line.startsWith('data:')) line = line.substring(5).trim();
      if (line.isEmpty || line == '[DONE]') continue;
      try {
        final value = jsonDecode(line);
        if (value is Map) {
          final type = value['type']?.toString();
          final delta = value['delta'] ?? value['text'] ?? value['textDelta'];
          if (delta is String && (type == null || type.contains('text'))) output.write(delta);
        }
        continue;
      } catch (_) {
        // AI SDK data-stream format may encode text as a JSON string after `0:`.
      }
      if (line.startsWith('0:')) {
        try {
          final value = jsonDecode(line.substring(2));
          if (value is String) output.write(value);
        } catch (_) {}
      }
    }
    final result = output.toString().trim();
    return result.isEmpty ? body.trim() : result;
  }

  List<AiMemoryItem> loadMemory() {
    final raw = localStore.read(_memoryKey);
    if (!memoryEnabled || raw is! List) return const <AiMemoryItem>[];
    return raw.whereType<Map>().map((item) => AiMemoryItem.fromJson(Map<String, dynamic>.from(item))).toList();
  }

  Future<void> addMemory(String text) async {
    if (!memoryEnabled || text.trim().isEmpty) return;
    final item = AiMemoryItem(id: _uuid(), text: text.trim(), createdAt: DateTime.now());
    final values = loadMemory().map((value) => value.toJson()).toList()..add(item.toJson());
    await localStore.write(_memoryKey, values);
    unawaited(sync.syncNow());
  }

  Future<void> updateMemory(String id, String text) async {
    final values = loadMemory().map((item) => item.id == id ? AiMemoryItem(id: item.id, text: text.trim(), createdAt: item.createdAt, updatedAt: DateTime.now()).toJson() : item.toJson()).toList();
    await localStore.write(_memoryKey, values);
    unawaited(sync.syncNow());
  }

  Future<void> deleteMemory(String id) async {
    final values = loadMemory().where((item) => item.id != id).map((item) => item.toJson()).toList();
    await localStore.write(_memoryKey, values);
    unawaited(sync.syncNow());
  }

  Future<void> _saveLocalConversations(List<AiConversation> conversations) async {
    await localStore.write(_conversationKey, conversations.map((item) => item.toJson()).toList());
    unawaited(sync.syncNow());
  }

  Future<void> _replaceMessages(String id, List<AiMessage> messages) async {
    final conversations = loadLocalConversations();
    final index = conversations.indexWhere((item) => item.id == id);
    if (index < 0) return;
    conversations[index] = conversations[index].copyWith(messages: messages, updatedAt: DateTime.now());
    await _saveLocalConversations(conversations);
  }

  Future<void> _insertCloudMessage(AiConversation conversation, AiMessage message) async {
    if (conversation.ephemeral) return;
    final client = _client;
    final user = auth.currentUser;
    if (client == null || user == null) return;
    try {
      await client.from('ai_messages').upsert({
        'id': message.id,
        'conversation_id': conversation.id,
        'user_id': user.id,
        'role': message.role,
        'plain_text': message.text,
        'parts': [
          {'type': 'text', 'text': message.text}
        ],
        'model_message_id': message.id,
      });
    } catch (_) {}
  }

  String _uuid() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    String hex(int value) => value.toRadixString(16).padLeft(2, '0');
    final h = bytes.map(hex).join();
    return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}';
  }
}
