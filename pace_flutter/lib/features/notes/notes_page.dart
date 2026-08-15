import 'package:flutter/material.dart';

import '../../core/storage/local_store.dart';
import '../../ui/pace_theme.dart';

class NotesPage extends StatefulWidget {
  const NotesPage({super.key, required this.localStore});
  final LocalStore localStore;

  @override
  State<NotesPage> createState() => _NotesPageState();
}

class _NotesPageState extends State<NotesPage> {
  List<Map<String, dynamic>> _notes() {
    final raw = widget.localStore.read('pace.notes');
    if (raw is! List) return [];
    return raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }

  Future<void> _edit([Map<String, dynamic>? existing]) async {
    final title = TextEditingController(text: existing?['title']?.toString() ?? '');
    final body = TextEditingController(text: existing?['body']?.toString() ?? '');
    final result = await showDialog<Map<String, String>>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(existing == null ? 'Nouvelle note' : 'Modifier la note'),
        content: SizedBox(width: 520, child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: title, decoration: const InputDecoration(labelText: 'Titre')),
          const SizedBox(height: 8),
          TextField(controller: body, minLines: 5, maxLines: 10, decoration: const InputDecoration(labelText: 'Texte')),
        ])),
        actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Annuler')), FilledButton(onPressed: () => Navigator.pop(context, {'title': title.text.trim(), 'body': body.text}), child: const Text('Enregistrer'))],
      ),
    );
    title.dispose();
    body.dispose();
    if (result == null || (result['title'] ?? '').isEmpty) return;
    final notes = _notes();
    final id = existing?['id']?.toString();
    final next = {'id': id ?? DateTime.now().microsecondsSinceEpoch.toString(), 'title': result['title'], 'body': result['body'], 'updatedAt': DateTime.now().toIso8601String()};
    if (id == null) {
      notes.insert(0, next);
    } else {
      final index = notes.indexWhere((note) => note['id']?.toString() == id);
      if (index >= 0) notes[index] = next;
    }
    await widget.localStore.write('pace.notes', notes);
    if (mounted) setState(() {});
  }

  Future<void> _delete(Map<String, dynamic> note) async {
    final notes = _notes()..removeWhere((n) => n['id']?.toString() == note['id']?.toString());
    await widget.localStore.write('pace.notes', notes);
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final notes = _notes();
    return ListView(padding: const EdgeInsets.all(20), children: [
      Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text('Notes', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700)), IconButton(onPressed: _edit, icon: const Icon(Icons.add))]),
      const SizedBox(height: 14),
      if (notes.isEmpty) const PaceGlassCard(child: ListTile(title: Text('Aucune note'))),
      for (final note in notes)
        Padding(padding: const EdgeInsets.only(bottom: 8), child: PaceGlassCard(child: ListTile(
          title: Text(note['title']?.toString() ?? 'Note'),
          subtitle: Text(note['body']?.toString() ?? '', maxLines: 3, overflow: TextOverflow.ellipsis),
          onTap: () => _edit(note),
          trailing: IconButton(onPressed: () => _delete(note), icon: const Icon(Icons.delete_outline)),
        ))),
    ]);
  }
}
