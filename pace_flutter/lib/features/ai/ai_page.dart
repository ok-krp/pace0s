import 'package:cross_file/cross_file.dart';
import 'package:flutter/material.dart';

import '../../core/photo/photo_picker_button.dart';
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
  late final PaceAiService _service = PaceAiService(localStore: widget.localStore, sync: widget.sync, auth: widget.auth);
  final _input = TextEditingController();
  final _scroll = ScrollController();
  List<AiConversation> _history = const [];
  AiConversation? _conversation;
  List<AiMessage> _messages = const [];
  XFile? _selectedImage;
  bool _loading = false;
  bool _ephemeral = false;
  String _search = '';

  @override
  void initState() {
    super.initState();
    _openInitialConversation();
  }

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _openInitialConversation() async {
    final history = await _service.loadConversations();
    if (!mounted) return;
    setState(() => _history = history);
    if (history.isNotEmpty) {
      await _openConversation(history.first);
    } else {
      await _newConversation();
    }
  }

  Future<void> _newConversation() async {
    final conversation = await _service.createConversation(ephemeral: _ephemeral);
    if (!mounted) return;
    setState(() {
      _conversation = conversation;
      _messages = const [];
      _selectedImage = null;
    });
    if (!_ephemeral) setState(() => _history = _service.loadLocalConversations());
  }

  Future<void> _openConversation(AiConversation conversation) async {
    final messages = await _service.loadMessages(conversation.id);
    if (!mounted) return;
    setState(() {
      _ephemeral = false;
      _conversation = conversation;
      _messages = messages;
      _selectedImage = null;
    });
    _jumpToEnd();
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    final conversation = _conversation;
    final image = _selectedImage;
    if ((text.isEmpty && image == null) || conversation == null || _loading) return;
    _input.clear();
    final optimistic = AiMessage(id: 'local-${DateTime.now().microsecondsSinceEpoch}', role: 'user', text: text, createdAt: DateTime.now());
    setState(() {
      _messages = [..._messages, optimistic];
      _loading = true;
    });
    _jumpToEnd();
    try {
      final response = image == null
          ? await _service.send(conversation: conversation, text: text)
          : await _service.sendWithImage(conversation: conversation, text: text, image: image);
      if (!mounted) return;
      setState(() {
        _selectedImage = null;
        _messages = [..._messages, AiMessage(id: 'assistant-${DateTime.now().microsecondsSinceEpoch}', role: 'assistant', text: response, createdAt: DateTime.now())];
        _loading = false;
        _history = _service.loadLocalConversations();
      });
      _jumpToEnd();
    } catch (error) {
      if (!mounted) return;
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
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        IconButton.filledTonal(
                          tooltip: 'Ajouter une photo',
                          onPressed: _loading ? null : () {},
                          icon: const Icon(Icons.add),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              PhotoPickerButton(onChanged: (file) => setState(() => _selectedImage = file), initialValue: _selectedImage),
                              const SizedBox(height: 8),
                              TextField(controller: _input, minLines: 1, maxLines: 6, onSubmitted: (_) => _send(), decoration: InputDecoration(hintText: _selectedImage == null ? (_ephemeral ? 'Message éphémère…' : 'Écrire à Pace IA…') : 'Décrivez ce que Pace doit analyser…', border: OutlineInputBorder(borderRadius: BorderRadius.circular(18)))),
                            ],
                          ),
                        ),
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
                return ListTile(selected: selected, title: Text(item.title, maxLines: 2, overflow: TextOverflow.ellipsis), subtitle: Text(_formatDate(item.updatedAt)), onTap: () => _openConversation(item), onLongPress: () => _conversationMenu(item));
              },
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _conversationMenu(AiConversation conversation) async {
    final action = await showModalBottomSheet<String>(context: context, builder: (_) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [ListTile(leading: const Icon(Icons.edit), title: const Text('Renommer'), onTap: () => Navigator.pop(context, 'rename')), ListTile(leading: const Icon(Icons.delete_outline), title: const Text('Supprimer'), onTap: () => Navigator.pop(context, 'delete'))])));
    if (action == 'rename' && mounted) {
      final controller = TextEditingController(text: conversation.title);
      final title = await showDialog<String>(context: context, builder: (_) => AlertDialog(title: const Text('Renommer'), content: TextField(controller: controller, autofocus: true), actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Annuler')), FilledButton(onPressed: () => Navigator.pop(context, controller.text), child: const Text('Enregistrer'))]));
      controller.dispose();
      if (title != null && title.trim().isNotEmpty) await _service.renameConversation(conversation.id, title);
    } else if (action == 'delete') {
      await _service.deleteConversation(conversation.id);
      if (conversation.id == _conversation?.id) await _newConversation();
    }
    if (mounted) setState(() => _history = _service.loadLocalConversations());
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

  @override
  void initState() {
    super.initState();
    _items = widget.service.loadMemory();
  }

  Future<void> _add() async {
    final controller = TextEditingController();
    final text = await showDialog<String>(context: context, builder: (_) => AlertDialog(title: const Text('Ajouter une mémoire'), content: TextField(controller: controller, autofocus: true, maxLines: 4), actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Annuler')), FilledButton(onPressed: () => Navigator.pop(context, controller.text), child: const Text('Ajouter'))]));
    controller.dispose();
    if (text != null && text.trim().isNotEmpty) {
      await widget.service.addMemory(text);
      setState(() => _items = widget.service.loadMemory());
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('Mémoire IA')), body: ListView(padding: const EdgeInsets.all(20), children: [SwitchListTile.adaptive(title: const Text('Mémoire IA'), subtitle: const Text('Autoriser Pace IA à conserver des souvenirs persistants.'), value: _enabled, onChanged: (value) async { await widget.service.setMemoryEnabled(value); setState(() { _enabled = value; _items = widget.service.loadMemory(); }); }), const SizedBox(height: 8), if (!_enabled) const Card(child: Padding(padding: EdgeInsets.all(16), child: Text('La mémoire est désactivée. Les souvenirs existants sont supprimés du stockage local.'))), if (_enabled) ...[FilledButton.icon(onPressed: _add, icon: const Icon(Icons.add), label: const Text('Ajouter un souvenir')), const SizedBox(height: 12), for (final item in _items) Card(child: ListTile(title: Text(item.text), subtitle: Text('Ajouté le ${item.createdAt.day}/${item.createdAt.month}/${item.createdAt.year}'), trailing: IconButton(icon: const Icon(Icons.delete_outline), onPressed: () async { await widget.service.deleteMemory(item.id); setState(() => _items = widget.service.loadMemory()); }))),],));
}
