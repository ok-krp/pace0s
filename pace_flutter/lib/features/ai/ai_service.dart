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
  PaceAiService({required this.localStore, required this.sync, required this.auth})
      : _accountUserId = localStore.activeUserId;

  final LocalStore localStore;
  final SyncService sync;
  final PaceAuthService auth;
  final String? _accountUserId;

  bool get _isAccountScopeCurrent {
    // Close the AI data/network boundary as soon as a transition is requested,
    // not only after LocalStore has finished switching its active file.
    if (localStore.isSwitchingAccount ||
        localStore.activeUserId != _accountUserId) {
      return false;
    }
    // Read the auth state directly here. Calling _scopedUser from this getter
    // would recurse through _scopedUser's own scope guard indefinitely.
    final user = auth.currentUser;
    return _accountUserId == null ? user == null : user?.id == _accountUserId;
  }

  User? get _scopedUser {
    if (!_isAccountScopeCurrent || _accountUserId == null) return null;
    final user = auth.currentUser;
    return user?.id == _accountUserId ? user : null;
  }

  static const _conversationKey = 'pace.ai.conversations';
  static const _deletedConversationKey = 'pace.ai.deleted_conversations';
  static const _legacyConversationImportKey =
      'pace.__sync_ai_conversations_imported';
  static const _memoryKey = 'pace.ai.memory';
  static const _memoryEnabledKey = 'pace.settings.ai.memory';
  static const _confirmKey = 'pace.settings.ai.confirm_actions';
  static const _aiUrl = String.fromEnvironment(
    'PACE_AI_URL',
    defaultValue: 'https://pace0s.lovable.app/api/ai-chat',
  );

  SupabaseClient? get _client => auth.client;

  bool get memoryEnabled {
    if (!_isAccountScopeCurrent) return true;
    final value = localStore.read(_memoryEnabledKey);
    return value is bool ? value : true;
  }

  bool get confirmActions {
    if (!_isAccountScopeCurrent) return true;
    final value = localStore.read(_confirmKey);
    return value is bool ? value : true;
  }

  Future<void> setMemoryEnabled(bool enabled) async {
    if (!_isAccountScopeCurrent) return;
    await localStore.writeBatchForAccount(
      _accountUserId,
      writes: enabled
          ? {_memoryEnabledKey: true}
          : {
              // Clear the sensitive payload in the same durable snapshot as
              // the preference, so an account switch cannot split the change.
              _memoryKey: <dynamic>[],
              _memoryEnabledKey: false,
            },
    );
    if (!_isAccountScopeCurrent) return;
    unawaited(sync.syncNow());
  }

  Future<void> setConfirmActions(bool enabled) async {
    if (!_isAccountScopeCurrent) return;
    await localStore.writeForAccount(_accountUserId, _confirmKey, enabled);
    if (!_isAccountScopeCurrent) return;
    // SyncService owns the guarded user_state -> ai_preferences propagation.
    // A direct upsert here bypasses its retry marker and conflict checks, so a
    // stale local boolean could overwrite a newer remote preference.
    unawaited(sync.syncNow());
  }

  List<AiConversation> loadLocalConversations() {
    if (!_isAccountScopeCurrent) return const <AiConversation>[];
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
    final initialLocal = loadLocalConversations();
    var local = initialLocal.where((item) => item.agent == agent).toList();
    final client = _client;
    final user = _scopedUser;
    if (client == null || user == null) return local;

    try {
      await _retryPendingConversationDeletes(client, user.id);
      if (!_isAccountScopeCurrent) return const <AiConversation>[];
      // Even if a delete remains blocked by an offline/network/RLS error,
      // its tombstone suppresses both local and remote copies until retry.
      final pendingDeleteIds = _pendingDeletedConversationIds().toSet();
      try {
        await _importLegacyConversationSnapshotIfNeeded(
          client,
          user,
          pendingDeleteIds,
        );
      } catch (_) {
        // Legacy compatibility import is best-effort. A missing/temporarily
        // unavailable user_state row must not block the dedicated AI tables.
        if (!_isAccountScopeCurrent) return const <AiConversation>[];
      }
      if (!_isAccountScopeCurrent) return const <AiConversation>[];
      local = loadLocalConversations()
          .where((item) => item.agent == agent)
          .where((item) => !pendingDeleteIds.contains(item.id))
          .toList();
      // PostgREST applies a server-side row cap. Page conversation metadata
      // explicitly so older records do not disappear from the native history
      // once an account exceeds that cap.
      const pageSize = 500;
      var offset = 0;
      final rows = <Map<String, dynamic>>[];
      while (true) {
        final page = await client
            .from('ai_conversations')
            .select('id,agent_type,title,is_starred,is_archived,is_ephemeral,updated_at')
            .eq('user_id', user.id)
            .eq('agent_type', agent.name)
            .eq('is_ephemeral', false)
            .order('updated_at', ascending: false)
            .order('id')
            .range(offset, offset + pageSize - 1);
        if (!_isAccountScopeCurrent) return const <AiConversation>[];
        rows.addAll(page);
        if (page.length < pageSize) break;
        offset += pageSize;
      }
      final remote = rows.map((row) {
        final value = Map<String, dynamic>.from(row);
        return AiConversation(
          id: value['id']?.toString() ?? '',
          agent: agent,
          title: value['title']?.toString() ?? 'Nouvelle conversation',
          updatedAt: LocalStore.isValidRemoteTimestamp(value['updated_at']?.toString() ?? '')
              ? DateTime.parse(value['updated_at'] as String).toLocal()
              : DateTime.fromMillisecondsSinceEpoch(0),
        );
      }).where((item) => !pendingDeleteIds.contains(item.id)).toList();
      // A rename can be committed locally while offline and its cloud update
      // can fail. Retry local versions newer than the fetched row. Only title
      // and updated_at are changed; unrelated remote metadata remains intact.
      final remoteById = <String, AiConversation>{
        for (final item in remote) item.id: item,
      };
      for (final item in local) {
        final remoteItem = remoteById[item.id];
        if (remoteItem == null ||
            !shouldRetryConversationRename(local: item, remote: remoteItem)) {
          continue;
        }
        if (!_isAccountScopeCurrent) return const <AiConversation>[];
        try {
          await client.from('ai_conversations').update({
            'title': item.title,
            'updated_at': item.updatedAt.toUtc().toIso8601String(),
          }).eq('id', item.id)
              .eq('user_id', user.id)
              // Compare-and-set against the exact server version fetched in
              // this load, not the locally advanced timestamp. This allows an
              // offline rename to retry while still rejecting a concurrent
              // remote edit that lands after the SELECT.
              .eq(
                'updated_at',
                renameRetryExpectedRemoteVersion(remoteItem),
              )
              .select('id');
        } catch (_) {
          // Keep the local title; the next load retries the update.
        }
      }

      // A conversation can be saved locally while offline and its initial
      // cloud insert can fail. Retry only IDs absent from the fetched remote
      // set; ignoreDuplicates protects a row created concurrently by another
      // device without overwriting its title or metadata.
      final remoteIds = remote.map((item) => item.id).toSet();
      final missingRemote = local.where((item) => !remoteIds.contains(item.id));
      for (final item in missingRemote) {
        if (!_isAccountScopeCurrent) return const <AiConversation>[];
        try {
          await client.from('ai_conversations').upsert({
            'id': item.id,
            'user_id': user.id,
            'agent_type': item.agent.name,
            'title': item.title,
            'is_ephemeral': false,
          }, onConflict: 'id', ignoreDuplicates: true);
        } catch (_) {
          // Keep the durable local conversation; the next load retries it.
        }
      }
      if (!_isAccountScopeCurrent) return const <AiConversation>[];

      final merged = <String, AiConversation>{for (final item in local) item.id: item};
      for (final item in remote) {
        final existing = merged[item.id];
        merged[item.id] = existing == null ? item : existing.mergeRemoteMetadata(item);
      }
      final result = merged.values.where((item) => item.agent == agent).toList()..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
      final saved = await _saveAgentConversationSnapshot(agent, result);
      return _isAccountScopeCurrent ? saved : const <AiConversation>[];
    } catch (_) {
      return _isAccountScopeCurrent ? local : const <AiConversation>[];
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
      final conversations = loadLocalConversations().toList()
        ..insert(0, conversation);
      await _saveLocalConversations(conversations);
      final client = _client;
      final user = _scopedUser;
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

  /// Message activity also advances the local conversation timestamp. Retry
  /// a metadata write only when the title itself differs; otherwise an offline
  /// message must not cause an unnecessary remote UPDATE on every history load.
  static bool shouldRetryConversationRename({
    required AiConversation local,
    required AiConversation remote,
  }) =>
      local.id == remote.id &&
      local.title != remote.title &&
      local.updatedAt.isAfter(remote.updatedAt);

  /// The CAS baseline for a retry is the server row just fetched, not the
  /// local timestamp advanced by the offline rename.
  static String renameRetryExpectedRemoteVersion(AiConversation remote) =>
      remote.updatedAt.toUtc().toIso8601String();

  Future<void> renameConversation(String id, String title) async {
    final normalized = title.trim().replaceAll(RegExp(r'\s+'), ' ');
    final clean = normalized.isEmpty ? 'Nouvelle conversation' : normalized.substring(0, min(80, normalized.length));
    final conversations = loadLocalConversations();
    final index = conversations.indexWhere((item) => item.id == id);
    if (index >= 0) {
      final previousUpdatedAt = conversations[index].updatedAt;
      final now = DateTime.now();
      final renamedAt = now.isAfter(previousUpdatedAt)
          ? now
          : previousUpdatedAt.add(const Duration(microseconds: 1));
      final expectedRemoteUpdatedAt = previousUpdatedAt.toUtc().toIso8601String();
      conversations[index] = conversations[index].copyWith(
        title: clean,
        updatedAt: renamedAt,
      );
      await _saveLocalConversations(conversations);
      final client = _client;
      final user = _scopedUser;
      if (client != null && user != null && _isAccountScopeCurrent) {
        try {
          await client.from('ai_conversations').update({
            'title': clean,
            'updated_at': renamedAt.toUtc().toIso8601String(),
          }).eq('id', id)
              .eq('user_id', user.id)
              // Compare-and-set against the last version this device knew.
              // A concurrent remote edit wins, even if this device's clock is ahead.
              .eq('updated_at', expectedRemoteUpdatedAt);
        } catch (_) {
          // The local rename is durable. loadConversations retries it when the
          // network returns, and its timestamp guard protects newer remote edits.
        }
      }
    }
  }

  Future<void> deleteConversation(String id) async {
    if (!_isAccountScopeCurrent) return;
    final client = _client;
    final user = _scopedUser;
    if (client != null && user != null) {
      // Persist a local tombstone before removing the conversation. If the
      // remote delete fails offline, loadConversations retries it before
      // reading the remote list so the deleted item cannot reappear.
      final pending = _pendingDeletedConversationIds();
      if (!pending.contains(id)) pending.add(id);
      await localStore.writeForAccount(
        _accountUserId,
        _deletedConversationKey,
        pending,
        enqueueSync: false,
      );
      if (!_isAccountScopeCurrent) return;
    }
    final conversations = loadLocalConversations().toList()
      ..removeWhere((item) => item.id == id);
    await _saveLocalConversations(conversations);
    if (client != null && user != null) {
      await _retryPendingConversationDeletes(client, user.id);
    }
  }

  List<String> _pendingDeletedConversationIds() {
    final raw = localStore.read(_deletedConversationKey);
    if (raw is! List) return <String>[];
    return raw.whereType<String>().where((id) => id.isNotEmpty).toSet().toList();
  }

  Future<void> _retryPendingConversationDeletes(
    SupabaseClient client,
    String userId,
  ) async {
  /// An empty DELETE response is not proof of deletion: RLS may filter the
  /// mutation result. Only a returned row for this ID confirms the tombstone
  /// can be cleared safely.
  static bool deleteResponseConfirmsRemoval({
    required List<Map<String, dynamic>> rows,
    required String conversationId,
  }) =>
      rows.any((row) => row['id']?.toString() == conversationId);


    final pending = _pendingDeletedConversationIds();
    if (pending.isEmpty) return;
    final deletedRemotely = <String>{};
    for (final id in pending) {
      if (!_isAccountScopeCurrent || userId != _accountUserId) return;
      try {
        final deletedRows = await client
            .from('ai_conversations')
            .delete()
            .eq('id', id)
            .eq('user_id', userId)
            .select('id');
        if (deleteResponseConfirmsRemoval(rows: deletedRows, conversationId: id)) {
          deletedRemotely.add(id);
          continue;
        }

        // An empty DELETE response is ambiguous: PostgREST can return no rows
        // when RLS filters the mutation, and the follow-up SELECT can also be
        // empty when RLS hides the row. That is not proof that the tombstone
        // reached the server. Retain it and retry on a later load rather than
        // accidentally allowing a hidden conversation to reappear if policy
        // visibility changes. Only a returned deleted ID confirms success.
      } catch (_) {
        // Retain failed deletes durably for the next online conversation load.
      }
    }
    if (!_isAccountScopeCurrent || deletedRemotely.isEmpty) return;
    // Re-read after network awaits: a concurrent delete can add another
    // tombstone while this pass is in flight. Never overwrite that new work
    // with a stale copy of the queue captured before the requests.
    final remaining = _pendingDeletedConversationIds()
        .where((id) => !deletedRemotely.contains(id))
        .toList();
    await localStore.writeForAccount(
      _accountUserId,
      _deletedConversationKey,
      remaining,
      enqueueSync: false,
    );
  }

  Future<List<AiMessage>> loadMessages(String id) async {
    final local = loadLocalConversations().firstWhere(
      (item) => item.id == id,
      orElse: () => AiConversation(
        id: '',
        agent: PaceAiAgent.coach,
        title: '',
        updatedAt: DateTime.fromMillisecondsSinceEpoch(0),
      ),
    );
    final client = _client;
    final user = _scopedUser;
    if (client == null || user == null) return local.messages;

    try {
      // Always refresh the remote message list when authenticated. Returning
      // the local cache merely because it is non-empty prevents messages sent
      // from another device from ever appearing on this device.
      // Message history can exceed PostgREST's default maximum row count.
      // Fetch every page; otherwise later messages from another device remain
      // invisible and can be mistaken for a successful complete refresh.
      const pageSize = 500;
      var offset = 0;
      final rows = <Map<String, dynamic>>[];
      while (true) {
        final page = await client
            .from('ai_messages')
            .select('id,role,plain_text,created_at')
            .eq('conversation_id', id)
            .eq('user_id', user.id)
            .order('created_at')
            .order('id')
            .range(offset, offset + pageSize - 1);
        if (!_isAccountScopeCurrent) return const <AiMessage>[];
        rows.addAll(page);
        if (page.length < pageSize) break;
        offset += pageSize;
      }

      final remoteMessages = rows.map((row) {
        final rawTimestamp = row['created_at']?.toString() ?? '';
        return AiMessage(
          id: row['id']?.toString() ?? '',
          role: row['role']?.toString() ?? 'assistant',
          text: row['plain_text']?.toString() ?? '',
          createdAt: LocalStore.isValidRemoteTimestamp(rawTimestamp)
              ? DateTime.parse(rawTimestamp).toLocal()
              : DateTime.fromMillisecondsSinceEpoch(0),
        );
      }).toList();
      if (!_isAccountScopeCurrent) return const <AiMessage>[];
      final latestLocal = loadLocalConversations().firstWhere(
        (item) => item.id == id,
        orElse: () => AiConversation(
          id: '',
          agent: PaceAiAgent.coach,
          title: '',
          updatedAt: DateTime.fromMillisecondsSinceEpoch(0),
        ),
      );
      // A local send may have completed while the remote request was in
      // flight. Merge against the latest cache, not the stale snapshot captured
      // before the network await. If the conversation was deleted meanwhile,
      // do not resurrect its messages from the response.
      if (local.id.isNotEmpty && latestLocal.id.isEmpty) {
        return const <AiMessage>[];
      }
      final localHistory =
          latestLocal.id.isNotEmpty ? latestLocal.messages : local.messages;
      // Message uploads are best-effort. Retry local IDs missing from the
      // remote snapshot whenever history is loaded again, so a temporary
      // network error cannot strand a message on this device indefinitely.
      if (latestLocal.id.isNotEmpty) {
        for (final message in messagesMissingFromRemote(
          local: latestLocal.messages,
          remote: remoteMessages,
        )) {
          if (!_isAccountScopeCurrent) return const <AiMessage>[];
          await _insertCloudMessage(latestLocal, message);
        }
      }
      if (!_isAccountScopeCurrent) return const <AiMessage>[];
      final messages = mergeMessages(
        local: localHistory,
        remote: remoteMessages,
      );
      // Hydrating history is not a conversation edit: keep updatedAt unchanged
      // or an ordinary read can make stale local metadata beat the server.
      await _replaceMessages(id, messages, touchUpdatedAt: false);
      return _isAccountScopeCurrent ? messages : const <AiMessage>[];
    } catch (_) {
      if (!_isAccountScopeCurrent) return const <AiMessage>[];
      // The local conversation may have been deleted while the cloud read was
      // pending. Never return the stale pre-request snapshot on an error path.
      final latestLocal = loadLocalConversations().where((item) => item.id == id);
      return latestLocal.isEmpty
          ? const <AiMessage>[]
          : latestLocal.first.messages;
    }
  }

  /// Combines the cloud history with local-only messages and local versions of
  /// duplicate IDs. A failed earlier upload must not be lost on refresh.
  /// Local messages that have not reached the fetched cloud history yet.
  /// IDs are stable upsert keys, so retrying these uploads is idempotent.
  static List<AiMessage> messagesMissingFromRemote({
    required List<AiMessage> local,
    required List<AiMessage> remote,
  }) {
    final remoteIds = remote
        .map((message) => message.id)
        .where((id) => id.isNotEmpty)
        .toSet();
    final seen = <String>{};
    return local
        .where((message) =>
            message.id.isNotEmpty &&
            !remoteIds.contains(message.id) &&
            seen.add(message.id))
        .toList();
  }

  static List<AiMessage> mergeMessages({
    required List<AiMessage> local,
    required List<AiMessage> remote,
  }) {
    final indexed = <({int order, AiMessage message})>[];
    final indexById = <String, int>{};
    var nextOrder = 0;

    void addAll(List<AiMessage> source) {
      for (final message in source) {
        final id = message.id;
        if (id.isEmpty) {
          // Preserve malformed legacy messages rather than collapsing several
          // empty IDs into one entry.
          indexed.add((order: nextOrder++, message: message));
          continue;
        }
        final existingIndex = indexById[id];
        if (existingIndex == null) {
          indexById[id] = indexed.length;
          indexed.add((order: nextOrder++, message: message));
        } else {
          // Prefer the local payload for an ID whose upload may have failed,
          // without changing the original tie-order of the message.
          indexed[existingIndex] = (
            order: indexed[existingIndex].order,
            message: message,
          );
        }
      }
    }

    addAll(remote);
    addAll(local);
    indexed.sort((a, b) {
      final byTimestamp = a.message.createdAt.compareTo(b.message.createdAt);
      return byTimestamp != 0 ? byTimestamp : a.order.compareTo(b.order);
    });
    return indexed.map((entry) => entry.message).toList();
  }

  static List<AiMessage> historyForSend({
    required bool ephemeral,
    required List<AiMessage> ephemeralHistory,
    required List<AiMessage> persistedHistory,
  }) =>
      List<AiMessage>.unmodifiable(
        ephemeral ? ephemeralHistory : persistedHistory,
      );

  Future<String> send({
    required AiConversation conversation,
    required String text,
    List<AiMessage> ephemeralHistory = const <AiMessage>[],
  }) async {
    final clean = text.trim();
    if (clean.isEmpty) return '';
    final now = DateTime.now();
    final userMessage = AiMessage(id: _uuid(), role: 'user', text: clean, createdAt: now);
    final persistedHistory = conversation.ephemeral
        ? const <AiMessage>[]
        : await loadMessages(conversation.id);
    final previous = historyForSend(
      ephemeral: conversation.ephemeral,
      ephemeralHistory: ephemeralHistory,
      persistedHistory: persistedHistory,
    );
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
    if (!_isAccountScopeCurrent || _accountUserId == null) {
      throw StateError('Le compte Pace a changé pendant la requête IA.');
    }
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
    if (!_isAccountScopeCurrent) {
      throw StateError('Le compte Pace a changé pendant la requête IA.');
    }
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
        } catch (_) {
          // Ignore malformed stream frames; the final response is handled below.
        }
      }
    }
    final result = output.toString().trim();
    return result.isEmpty ? body.trim() : result;
  }

  List<AiMemoryItem> loadMemory() {
    if (!_isAccountScopeCurrent) return const <AiMemoryItem>[];
    final raw = localStore.read(_memoryKey);
    if (!memoryEnabled || raw is! List) return const <AiMemoryItem>[];
    return raw.whereType<Map>().map((item) => AiMemoryItem.fromJson(Map<String, dynamic>.from(item))).toList();
  }

  Future<void> addMemory(String text) async {
    if (!memoryEnabled || text.trim().isEmpty) return;
    final item = AiMemoryItem(id: _uuid(), text: text.trim(), createdAt: DateTime.now());
    final values = loadMemory().map((value) => value.toJson()).toList()..add(item.toJson());
    await localStore.writeForAccount(_accountUserId, _memoryKey, values);
    if (!_isAccountScopeCurrent) return;
    unawaited(sync.syncNow());
  }

  Future<void> updateMemory(String id, String text) async {
    final values = loadMemory().map((item) => item.id == id ? AiMemoryItem(id: item.id, text: text.trim(), createdAt: item.createdAt, updatedAt: DateTime.now()).toJson() : item.toJson()).toList();
    await localStore.writeForAccount(_accountUserId, _memoryKey, values);
    if (!_isAccountScopeCurrent) return;
    unawaited(sync.syncNow());
  }

  Future<void> deleteMemory(String id) async {
    final values = loadMemory().where((item) => item.id != id).map((item) => item.toJson()).toList();
    await localStore.writeForAccount(_accountUserId, _memoryKey, values);
    if (!_isAccountScopeCurrent) return;
    unawaited(sync.syncNow());
  }

  /// Merge a remote refresh for one agent into the latest local snapshot.
  ///
  /// The conversation key stores every non-ephemeral agent together. Replacing
  /// that key with a single agent's remote result can erase the other agent's
  /// offline conversations, or a conversation created while this refresh was
  /// awaiting the network. Latest local edits win ties; a strictly newer
  /// refreshed item wins over an older local copy.
  static List<AiConversation> mergeAgentSnapshot({
    required PaceAiAgent agent,
    required List<AiConversation> latestLocal,
    required List<AiConversation> refreshed,
    Set<String> pendingDeleteIds = const <String>{},
  }) {
    final merged = <String, AiConversation>{};

    for (final conversation in refreshed) {
      if (conversation.agent != agent ||
          pendingDeleteIds.contains(conversation.id)) {
        continue;
      }
      merged[conversation.id] = conversation;
    }

    for (final conversation in latestLocal) {
      if (pendingDeleteIds.contains(conversation.id)) continue;
      final current = merged[conversation.id];
      if (current == null ||
          !conversation.updatedAt.isBefore(current.updatedAt)) {
        merged[conversation.id] = conversation;
      }
    }

    return merged.values.toList()
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
  }

  /// Compares snapshots by conversation ID and payload, ignoring list ordering.
  /// Equal reads must not create a new outbox timestamp or schedule a sync.
  static bool hasConversationSnapshotChanged({
    required List<AiConversation> current,
    required List<AiConversation> next,
  }) {
    if (current.length != next.length) return true;
    final currentById = <String, String>{};
    final nextById = <String, String>{};
    for (final conversation in current) {
      if (currentById.containsKey(conversation.id)) return true;
      currentById[conversation.id] = jsonEncode(conversation.toJson());
    }
    for (final conversation in next) {
      if (nextById.containsKey(conversation.id)) return true;
      nextById[conversation.id] = jsonEncode(conversation.toJson());
    }
    if (currentById.length != nextById.length) return true;
    for (final entry in currentById.entries) {
      if (nextById[entry.key] != entry.value) return true;
    }
    return false;
  }

  /// One-time, targeted compatibility import for installations whose old AI
  /// history exists only in user_state. Normal sync queries exclude this large
  /// duplicate cache; after importing it locally, dedicated AI tables are the
  /// cloud source of truth and retries migrate any missing rows/messages.
  Future<void> _importLegacyConversationSnapshotIfNeeded(
    SupabaseClient client,
    User user,
    Set<String> pendingDeleteIds,
  ) async {
    if (!_isAccountScopeCurrent ||
        localStore.read(_legacyConversationImportKey) == true) {
      return;
    }

    final rows = await client
        .from('user_state')
        .select('key,value,updated_at')
        .eq('user_id', user.id)
        .inFilter('key', const [
          'pace.ai.conversations',
          'lt.ai.conversations',
        ])
        .order('updated_at', ascending: false);
    if (!_isAccountScopeCurrent) return;

    final imported = <AiConversation>[];
    for (final row in rows.whereType<Map>()) {
      final rawValue = row['value'];
      final value = rawValue is Map && rawValue['value'] is List
          ? rawValue['value']
          : rawValue;
      if (value is! List) continue;
      for (final rawConversation in value.whereType<Map>()) {
        try {
          final conversation = AiConversation.fromJson(
            Map<String, dynamic>.from(rawConversation),
          );
          if (conversation.id.isNotEmpty &&
              !conversation.ephemeral &&
              !pendingDeleteIds.contains(conversation.id)) {
            imported.add(conversation);
          }
        } catch (_) {
          // Ignore one malformed legacy item without losing valid siblings.
        }
      }
    }

    final current = loadLocalConversations();
    final merged = mergeLegacyConversationSnapshots(
      current: current,
      imported: imported,
      pendingDeleteIds: pendingDeleteIds,
    );
    if (hasConversationSnapshotChanged(current: current, next: merged)) {
      await _saveLocalConversations(merged);
    }
    if (!_isAccountScopeCurrent) return;
    await localStore.writeForAccount(
      _accountUserId,
      _legacyConversationImportKey,
      true,
      enqueueSync: false,
    );
  }

  /// Merge legacy rows without replacing newer local edits or resurrecting
  /// conversations that already have a local deletion tombstone.
  static List<AiConversation> mergeLegacyConversationSnapshots({
    required List<AiConversation> current,
    required List<AiConversation> imported,
    required Set<String> pendingDeleteIds,
  }) {
    final byId = <String, AiConversation>{
      for (final item in current)
        if (item.id.isNotEmpty && !pendingDeleteIds.contains(item.id))
          item.id: item,
    };
    for (final incoming in imported) {
      if (incoming.id.isEmpty ||
          incoming.ephemeral ||
          pendingDeleteIds.contains(incoming.id)) {
        continue;
      }
      final existing = byId[incoming.id];
      if (existing == null || incoming.updatedAt.isAfter(existing.updatedAt)) {
        byId[incoming.id] = incoming;
      }
    }
    return byId.values.toList()
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
  }

  Future<List<AiConversation>> _saveAgentConversationSnapshot(
    PaceAiAgent agent,
    List<AiConversation> refreshed,
  ) async {
    if (!_isAccountScopeCurrent) return const <AiConversation>[];
    final latestLocal = loadLocalConversations();
    final merged = mergeAgentSnapshot(
      agent: agent,
      latestLocal: latestLocal,
      refreshed: refreshed,
      pendingDeleteIds: _pendingDeletedConversationIds().toSet(),
    );
    if (hasConversationSnapshotChanged(current: latestLocal, next: merged)) {
      // The dedicated conversation/message tables are the cloud source of
      // truth; refreshing a local snapshot must not enqueue its full transcript
      // as a duplicate user_state payload.
      await _saveLocalConversations(merged);
      if (!_isAccountScopeCurrent) return const <AiConversation>[];
    }
    return _isAccountScopeCurrent
        ? (merged.where((item) => item.agent == agent).toList()
          ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt)))
        : const <AiConversation>[];
  }

  Future<void> _saveLocalConversations(List<AiConversation> conversations) async {
    if (!_isAccountScopeCurrent) return;
    // Conversation metadata and messages have dedicated cloud tables. Keep the
    // full local transcript snapshot on disk only instead of duplicating it as
    // a large user_state.value payload on every edit or history refresh.
    await localStore.writeForAccount(
      _accountUserId,
      _conversationKey,
      conversations.map((item) => item.toJson()).toList(),
      enqueueSync: false,
    );
  }

  static bool hasMessageListChanged({
    required List<AiMessage> current,
    required List<AiMessage> next,
  }) =>
      jsonEncode(current.map((message) => message.toJson()).toList()) !=
      jsonEncode(next.map((message) => message.toJson()).toList());

  Future<void> _replaceMessages(
    String id,
    List<AiMessage> messages, {
    bool touchUpdatedAt = true,
  }) async {
    final conversations = loadLocalConversations();
    final index = conversations.indexWhere((item) => item.id == id);
    if (index < 0) return;
    final existing = conversations[index];
    final messagesChanged = hasMessageListChanged(
      current: existing.messages,
      next: messages,
    );
    if (!touchUpdatedAt && !messagesChanged) return;
    conversations[index] = existing.copyWith(
      messages: messages,
      updatedAt: touchUpdatedAt ? DateTime.now() : existing.updatedAt,
    );
    await _saveLocalConversations(conversations);
  }

  Future<void> _insertCloudMessage(AiConversation conversation, AiMessage message) async {
    if (conversation.ephemeral) return;
    final client = _client;
    final user = _scopedUser;
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
