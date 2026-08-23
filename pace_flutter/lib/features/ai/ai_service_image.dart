part of 'ai_service.dart';

extension PaceAiImageSupport on PaceAiService {
  Future<String> sendWithImage({
    required AiConversation conversation,
    required String text,
    required XFile image,
  }) async {
    final clean = text.trim();
    if (clean.isEmpty) return '';

    final now = DateTime.now();
    final userMessage = AiMessage(id: _uuid(), role: 'user', text: clean, createdAt: now);
    final previous = await loadMessages(conversation.id);
    final next = [...previous, userMessage];
    if (!conversation.ephemeral) await _replaceMessages(conversation.id, next);
    await _insertCloudMessage(conversation, userMessage);

    final responseText = await _requestModelWithImage(conversation, next, image);
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

  Future<String> _requestModelWithImage(AiConversation conversation, List<AiMessage> messages, XFile image) async {
    final token = _client?.auth.currentSession?.accessToken;
    if (token == null || token.isEmpty) {
      throw StateError('Connectez-vous à Pace pour utiliser l’IA.');
    }

    final bytes = await image.readAsBytes();
    if (bytes.isEmpty) throw StateError('Impossible de lire l’image sélectionnée.');
    final dataUrl = 'data:${_imageMediaType(image)};base64,${base64Encode(bytes)}';
    final payload = <String, dynamic>{
      'conversationId': conversation.id,
      'agentType': conversation.agent.name,
      'ephemeral': conversation.ephemeral,
      'messages': messages.asMap().entries.map((entry) {
        final message = entry.value;
        final isNewest = entry.key == messages.length - 1;
        final parts = <Map<String, dynamic>>[
          {'type': 'text', 'text': message.text},
        ];
        if (isNewest) {
          parts.add({
            'type': 'file',
            'mediaType': _imageMediaType(image),
            'filename': image.name,
            'url': dataUrl,
          });
        }
        return {
          'id': message.id,
          'role': message.role,
          'parts': parts,
        };
      }).toList(),
    };

    final response = await http.post(
      Uri.parse(PaceAiService._aiUrl),
      headers: {'Authorization': 'Bearer $token', 'Content-Type': 'application/json', 'Accept': 'text/plain'},
      body: jsonEncode(payload),
    ).timeout(const Duration(minutes: 2));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError(response.body.isEmpty ? 'Le service IA a refusé la requête (${response.statusCode}).' : response.body);
    }
    return _parseAiStream(response.body);
  }

  String _imageMediaType(XFile image) {
    final name = image.name.toLowerCase();
    if (name.endsWith('.png')) return 'image/png';
    if (name.endsWith('.webp')) return 'image/webp';
    if (name.endsWith('.heic')) return 'image/heic';
    if (name.endsWith('.heif')) return 'image/heif';
    if (name.endsWith('.gif')) return 'image/gif';
    if (name.endsWith('.bmp')) return 'image/bmp';
    return 'image/jpeg';
  }
}
