part of 'ai_service.dart';

import 'package:cross_file/cross_file.dart';

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

    final dataUrl = await PhotoPickerService.dataUrl(image);
    final responseText = await _requestModel(
      conversation: conversation,
      messages: next,
      imageDataUrl: dataUrl,
      imageFilename: image.name,
      imageMediaType: PhotoPickerService.mediaTypeFor(image),
    );
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
}
