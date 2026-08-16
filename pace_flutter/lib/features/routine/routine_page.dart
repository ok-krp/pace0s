import 'package:flutter/material.dart';

import '../../core/storage/local_store.dart';
import '../../ui/pace_theme.dart';

class RoutinePage extends StatefulWidget {
  const RoutinePage({super.key, required this.localStore});
  final LocalStore localStore;

  @override
  State<RoutinePage> createState() => _RoutinePageState();
}

class _RoutinePageState extends State<RoutinePage> {
  String get _today {
    final d = DateTime.now();
    return '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }

  List<Map<String, dynamic>> _habits() {
    final raw = widget.localStore.read('pace.routine.list');
    if (raw is! List) return [];
    return raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }

  List<dynamic> _done() {
    final raw = widget.localStore.read('pace.routine.done');
    if (raw is Map && raw[_today] is List) return List<dynamic>.from(raw[_today] as List);
    return [];
  }

  Future<void> _toggle(Map<String, dynamic> habit) async {
    final raw = widget.localStore.read('pace.routine.done');
    final data = Map<String, dynamic>.from(raw is Map ? raw : {});
    final done = data[_today] is List ? List<dynamic>.from(data[_today] as List) : <dynamic>[];
    final id = habit['id']?.toString() ?? habit['name']?.toString();
    if (id == null) return;
    if (done.contains(id)) {
      done.remove(id);
    } else {
      done.add(id);
    }
    data[_today] = done;
    await widget.localStore.write('pace.routine.done', data);
    if (mounted) setState(() {});
  }

  Future<void> _add() async {
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Nouvelle habitude'),
        content: TextField(controller: controller, autofocus: true, decoration: const InputDecoration(labelText: 'Nom')),
        actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Annuler')), FilledButton(onPressed: () => Navigator.pop(context, controller.text.trim()), child: const Text('Ajouter'))],
      ),
    );
    controller.dispose();
    if (name == null || name.isEmpty) return;
    final habits = _habits();
    habits.add({'id': DateTime.now().microsecondsSinceEpoch.toString(), 'name': name});
    await widget.localStore.write('pace.routine.list', habits);
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final habits = _habits();
    final done = _done();
    return ListView(padding: const EdgeInsets.all(20), children: [
      Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text('Habitudes', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700)), IconButton(onPressed: _add, icon: const Icon(Icons.add))]),
      const SizedBox(height: 6),
      Text('${done.length}/${habits.length} aujourd’hui'),
      const SizedBox(height: 14),
      if (habits.isEmpty) const PaceGlassCard(child: ListTile(title: Text('Aucune habitude configurée'))),
      for (final habit in habits)
        Padding(padding: const EdgeInsets.only(bottom: 8), child: PaceGlassCard(child: CheckboxListTile(
          value: done.contains(habit['id']?.toString() ?? habit['name']?.toString()),
          onChanged: (_) => _toggle(habit),
          title: Text(habit['name']?.toString() ?? 'Habitude'),
        ))),
    ]);
  }
}
