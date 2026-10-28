import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/storage/local_store.dart';
import '../../core/supabase/pace_supabase.dart';
import '../../core/sync/sync_service.dart';
import 'ai_models.dart';
import 'ai_service.dart';

class AiPage extends StatefulWidget {
  const AiPage({super.key, required this.localStore, required this.auth, required this.sync});

  final LocalStore localStore;
  final PaceAuthService auth;
  final SyncService sync;

  @override
  State<AiPage> createState() => _AiPageState();
}

class _AiPageState extends State<AiPage> {
  late PaceAiService _service;
  late String? _accountUserId;
  final _input = TextEditingController();
  final _scroll = ScrollController();
  List<AiConversation> _history = const [];
  AiConversation? _conversation;
  List<AiMessage> _messages = const [];
  bool _loading = false;
  bool _ephemeral = false;
  bool _modalOpen = false;
  int _openGeneration = 0;
  int _sendGeneration = 0;
  String _search = '';

  @override
  void initState() {
    super.initState();
    _accountUserId = widget.localStore.activeUserId;
    _service = PaceAiService(
      localStore: widget.localStore,
      sync: widget.sync,
      auth: widget.auth,
    );
    widget.localStore.addListener(_onLocalStoreChanged);
    _openInitialConversation();
  }

  void _onLocalStoreChanged() {
    if (!mounted) return;
    final activeUserId = widget.localStore.activeUserId;
    if (activeUserId != _accountUserId) {
      // Account notifications must take precedence over the normal loading
      // guard: otherwise a slow model response can leave the prior account's
      // chat visible in this still-mounted widget.
      _accountUserId = activeUserId;
      _service = PaceAiService(
        localStore: widget.localStore,
        sync: widget.sync,
        auth: widget.auth,
      );
      ++_openGeneration;
      ++_sendGeneration;
      if (_modalOpen) {
        // The root navigator is already dismissing this route. Clear in-memory
        // data now, but defer the rebuild until the modal overlay has detached.
        _history = const [];
        _conversation = null;
        _messages = const [];
        _loading = false;
        _ephemeral = false;
        return;
      }
      setState(() {
        _history = const [];
        _conversation = null;
        _messages = const [];
        _loading = false;
        _ephemeral = false;
      });
      return;
    }
    if (_loading || _ephemeral || _modalOpen) return;
    final history = _service.loadLocalConversations();
    final currentId = _conversation?.id;
    AiConversation? updatedCurrent;
    for (final item in history) {
      if (item.id == currentId) {
        updatedCurrent = item;
        break;
      }
    }
    setState(() {
      _history = history;
      if (updatedCurrent != null) {
        _conversation = updatedCurrent;
        // Do not erase an already-loaded transcript if a metadata-only local
        // snapshot arrives before its messages have been cached.
        if (updatedCurrent.messages.isNotEmpty || _messages.isEmpty) {
          _messages = updatedCurrent.messages;
        }
      }
    });
  }

  @override
  void didUpdateWidget(covariant AiPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.localStore != widget.localStore) {
      oldWidget.localStore.removeListener(_onLocalStoreChanged);
      widget.localStore.addListener(_onLocalStoreChanged);
    }
    if (oldWidget.localStore != widget.localStore ||
        oldWidget.auth != widget.auth ||
        oldWidget.sync != widget.sync) {
      _accountUserId = widget.localStore.activeUserId;
      _service = PaceAiService(
        localStore: widget.localStore,
        sync: widget.sync,
        auth: widget.auth,
      );
      ++_openGeneration;
      ++_sendGeneration;
      _history = const [];
      _conversation = null;
      _messages = const [];
      _loading = false;
      _ephemeral = false;
      unawaited(_openInitialConversation());
    }
  }

  @override
  void dispose() {
    widget.localStore.removeListener(_onLocalStoreChanged);
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _openInitialConversation() async {
    final generation = ++_openGeneration;
    final history = await _service.loadConversations();
    if (!mounted || generation != _openGeneration) return;
    setState(() => _history = history);
    if (history.isNotEmpty) {
      await _openConversation(history.first);
    } else {
      await _newConversation();
    }
  }

  Future<void> _newConversation() async {
    final generation = ++_openGeneration;
    ++_sendGeneration;
    final conversation = await _service.createConversation(ephemeral: _ephemeral);
    if (!mounted || generation != _openGeneration) return;
    setState(() {
      _conversation = conversation;
      _messages = const [];
      _loading = false;
    });
    if (!_ephemeral) setState(() => _history = _service.loadLocalConversations());
  }

  Future<void> _openConversation(AiConversation conversation) async {
    final generation = ++_openGeneration;
    ++_sendGeneration;
    final messages = await _service.loadMessages(conversation.id);
    if (!mounted || generation != _openGeneration) return;
    setState(() {
      _ephemeral = false;
      _conversation = conversation;
      _messages = messages;
      _loading = false;
    });
    _jumpToEnd();
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    final conversation = _conversation;
    if (text.isEmpty || conversation == null || _loading) return;
    _input.clear();
    final conversationId = conversation.id;
    final sendGeneration = ++_sendGeneration;
    // Ephemeral chats keep their history only in this widget's memory. Capture
    // it before adding the optimistic message so the service can send context
    // without persisting any ephemeral message.
    final ephemeralHistory = List<AiMessage>.unmodifiable(_messages);
    final optimistic = AiMessage(id: 'local-${DateTime.now().microsecondsSinceEpoch}', role: 'user', text: text, createdAt: DateTime.now());
    setState(() {
      _messages = [..._messages, optimistic];
      _loading = true;
    });
    _jumpToEnd();
    try {
      final response = await _service.send(
        conversation: conversation,
        text: text,
        ephemeralHistory: ephemeralHistory,
      );
      if (!mounted ||
          sendGeneration != _sendGeneration ||
          _conversation?.id != conversationId) {
        return;
      }
      setState(() {
        _messages = [..._messages, AiMessage(id: 'assistant-${DateTime.now().microsecondsSinceEpoch}', role: 'assistant', text: response, createdAt: DateTime.now())];
        _loading = false;
        _history = _service.loadLocalConversations();
      });
      _jumpToEnd();
    } catch (error) {
      if (!mounted ||
          sendGeneration != _sendGeneration ||
          _conversation?.id != conversationId) {
        return;
      }
      setState(() => _loading = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString().replaceFirst('Bad state: ', ''))));
    }
  }

  void _jumpToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 180), curve: Curves.easeOut);
    });
  }

  @override
  Widget build(BuildContext context) {
    final conversation = _conversation;
    return Scaffold(
      appBar: AppBar(
        title: Text(_ephemeral ? 'Chat éphémère' : 'Pace IA'),
        actions: [
          IconButton(
            tooltip: 'Chat éphémère',
            icon: Icon(_ephemeral ? Icons.lock_clock : Icons.history),
            onPressed: () async {
              setState(() => _ephemeral = !_ephemeral);
              await _newConversation();
            },
          ),
          IconButton(tooltip: 'Mémoire', icon: const Icon(Icons.psychology_outlined), onPressed: () => _openMemory()),
        ],
      ),
      body: Row(
        children: [
          if (MediaQuery.sizeOf(context).width >= 900) SizedBox(width: 300, child: _historyPanel()),
          Expanded(
            child: Column(
              children: [
                if (_ephemeral) const MaterialBanner(content: Text('Chat éphémère : cette conversation ne sera pas enregistrée dans l’historique ni dans la mémoire.'), actions: [SizedBox.shrink()]),
                Expanded(
                  child: conversation == null
                      ? const Center(child: CircularProgressIndicator())
                      : ListView.builder(
                          controller: _scroll,
                          padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
                          itemCount: _messages.length + (_loading ? 1 : 0),
                          itemBuilder: (_, index) {
                            if (_loading && index == _messages.length) return const Align(alignment: Alignment.centerLeft, child: Padding(padding: EdgeInsets.all(12), child: CircularProgressIndicator()));
                            final message = _messages[index];
                            final isUser = message.role == 'user';
                            return Align(
                              alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
                              child: Container(
                                constraints: const BoxConstraints(maxWidth: 760),
                                margin: const EdgeInsets.only(bottom: 10),
                                padding: const EdgeInsets.all(14),
                                decoration: BoxDecoration(
                                  color: isUser ? Theme.of(context).colorScheme.primaryContainer : Theme.of(context).colorScheme.surfaceContainerHighest,
                                  borderRadius: BorderRadius.circular(18),
                                ),
                                child: SelectableText(message.text),
                              ),
                            );
                          },
                        ),
                ),
                SafeArea(
                  top: false,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(14, 8, 14, 14),
                    child: Row(
                      children: [
                        Expanded(child: TextField(controller: _input, minLines: 1, maxLines: 6, onSubmitted: (_) => _send(), decoration: InputDecoration(hintText: _ephemeral ? 'Message éphémère…' : 'Écrire à Pace IA…', border: OutlineInputBorder(borderRadius: BorderRadius.circular(18))))),
                        const SizedBox(width: 8),
                        IconButton.filled(tooltip: 'Envoyer', onPressed: _loading ? null : _send, icon: const Icon(Icons.arrow_upward)),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _historyPanel() {
    final filtered = _history.where((item) => item.title.toLowerCase().contains(_search.toLowerCase())).toList();
    return DecoratedBox(
      decoration: BoxDecoration(border: Border(right: BorderSide(color: Theme.of(context).dividerColor))),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: Row(children: [Expanded(child: TextField(onChanged: (value) => setState(() => _search = value), decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Rechercher', border: OutlineInputBorder()))), const SizedBox(width: 8), IconButton(onPressed: _newConversation, icon: const Icon(Icons.add))]),
          ),
          Expanded(
            child: ListView.builder(
              itemCount: filtered.length,
              itemBuilder: (_, index) {
                final item = filtered[index];
                final selected = item.id == _conversation?.id;
                return ListTile(
                  selected: selected,
                  title: Text(item.title, maxLines: 2, overflow: TextOverflow.ellipsis),
                  subtitle: Text(_formatDate(item.updatedAt)),
                  onTap: () => _openConversation(item),
                  onLongPress: () => _conversationMenu(item),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _conversationMenu(AiConversation conversation) async {
    final expectedUserId = _accountUserId;
    var controllerTransitionFinished = false;
    _modalOpen = true;
    try {
      final action = await showModalBottomSheet<String>(
        context: context,
        builder: (_) => SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: const Icon(Icons.edit),
                title: const Text('Renommer'),
                onTap: () => Navigator.pop(context, 'rename'),
              ),
              ListTile(
                leading: const Icon(Icons.delete_outline),
                title: const Text('Supprimer'),
                onTap: () => Navigator.pop(context, 'delete'),
              ),
            ],
          ),
        ),
      );
      if (!mounted || widget.localStore.activeUserId != expectedUserId) return;

      if (action == 'rename') {
        final controller = TextEditingController(text: conversation.title);
        String? title;
        try {
          title = await showDialog<String>(
            context: context,
            builder: (_) => AlertDialog(
              title: const Text('Renommer'),
              content: TextField(controller: controller, autofocus: true),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Annuler'),
                ),
                FilledButton(
                  onPressed: () => Navigator.pop(context, controller.text),
                  child: const Text('Enregistrer'),
                ),
              ],
            ),
          );
        } finally {
          await Future<void>.delayed(const Duration(milliseconds: 350));
          controller.dispose();
          controllerTransitionFinished = true;
        }
        if (!mounted ||
            widget.localStore.activeUserId != expectedUserId ||
            title == null ||
            title.trim().isEmpty) {
          return;
        }
        await _service.renameConversation(conversation.id, title);
      } else if (action == 'delete') {
        if (!mounted || widget.localStore.activeUserId != expectedUserId) {
          return;
        }
        await _service.deleteConversation(conversation.id);
        if (!mounted || widget.localStore.activeUserId != expectedUserId) return;
        if (conversation.id == _conversation?.id) await _newConversation();
      }

      if (mounted && widget.localStore.activeUserId == expectedUserId) {
        setState(() => _history = _service.loadLocalConversations());
      }
    } finally {
      if (!controllerTransitionFinished) {
        await Future<void>.delayed(const Duration(milliseconds: 350));
      }
      _modalOpen = false;
      if (mounted) {
        setState(() => _history = _service.loadLocalConversations());
      }
    }
  }

  Future<void> _openMemory() async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => AiMemoryPage(service: _service)));
    if (mounted) setState(() {});
  }

  String _formatDate(DateTime date) => '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}/${date.year}';
}

class AiMemoryPage extends StatefulWidget {
  const AiMemoryPage({super.key, required this.service});
  final PaceAiService service;

  @override
  State<AiMemoryPage> createState() => _AiMemoryPageState();
}

class _AiMemoryPageState extends State<AiMemoryPage> {
  late bool _enabled = widget.service.memoryEnabled;
  List<AiMemoryItem> _items = const [];
  bool _dialogOpen = false;

  @override
  void initState() {
    super.initState();
    _items = widget.service.loadMemory();
    widget.service.localStore.addListener(_onLocalStoreChanged);
  }

  void _onLocalStoreChanged() {
    if (!mounted) return;
    final enabled = widget.service.memoryEnabled;
    final items = widget.service.loadMemory();
    if (_dialogOpen) {
      _enabled = enabled;
      _items = items;
      return;
    }
    setState(() {
      _enabled = enabled;
      _items = items;
    });
  }

  @override
  void dispose() {
    widget.service.localStore.removeListener(_onLocalStoreChanged);
    super.dispose();
  }

  Future<void> _add() async {
    final expectedUserId = widget.service.localStore.activeUserId;
    final controller = TextEditingController();
    String? text;
    _dialogOpen = true;
    try {
      text = await showDialog<String>(
        context: context,
        builder: (_) => AlertDialog(
          title: const Text('Ajouter une mémoire'),
          content: TextField(controller: controller, autofocus: true, maxLines: 4),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Annuler'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, controller.text),
              child: const Text('Ajouter'),
            ),
          ],
        ),
      );
    } finally {
      await Future<void>.delayed(const Duration(milliseconds: 350));
      _dialogOpen = false;
      controller.dispose();
      if (mounted) {
        setState(() {
          _enabled = widget.service.memoryEnabled;
          _items = widget.service.loadMemory();
        });
      }
    }
    if (text == null ||
        text.trim().isEmpty ||
        widget.service.localStore.activeUserId != expectedUserId) {
      return;
    }
    await widget.service.addMemory(text);
    if (!mounted ||
        widget.service.localStore.activeUserId != expectedUserId) {
      return;
    }
    setState(() => _items = widget.service.loadMemory());
  }


  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Mémoire IA')),
        body: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            SwitchListTile.adaptive(title: const Text('Mémoire IA'), subtitle: const Text('Autoriser Pace IA à conserver des souvenirs persistants.'), value: _enabled, onChanged: (value) async { await widget.service.setMemoryEnabled(value); if (!mounted) return; setState(() { _enabled = value; _items = widget.service.loadMemory(); }); }),
            const SizedBox(height: 8),
            if (!_enabled)
              const Card(
                child: Padding(
                  padding: EdgeInsets.all(16),
                  child: Text('La mémoire est désactivée. Les souvenirs existants sont supprimés du stockage local.'),
                ),
              ),
            if (_enabled) ...[
              FilledButton.icon(onPressed: _add, icon: const Icon(Icons.add), label: const Text('Ajouter un souvenir')),
              const SizedBox(height: 12),
              for (final item in _items) Card(child: ListTile(title: Text(item.text), subtitle: Text('Ajouté le ${item.createdAt.day}/${item.createdAt.month}/${item.createdAt.year}'), trailing: IconButton(icon: const Icon(Icons.delete_outline), onPressed: () async { await widget.service.deleteMemory(item.id); if (!mounted) return; setState(() => _items = widget.service.loadMemory()); }))),
            ],
          ],
        ),
      );
}
