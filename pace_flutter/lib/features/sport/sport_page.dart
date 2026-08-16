import 'package:flutter/material.dart';

import '../../core/storage/local_store.dart';
import '../../ui/pace_theme.dart';

class SportPage extends StatefulWidget {
  const SportPage({super.key, required this.localStore});
  final LocalStore localStore;

  @override
  State<SportPage> createState() => _SportPageState();
}

class _SportPageState extends State<SportPage> {
  String _today() {
    final d = DateTime.now();
    return '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }

  List<Map<String, dynamic>> _exercises() {
    final raw = widget.localStore.read('pace.sport.exercises');
    if (raw is! List) return [];
    return raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }

  List<Map<String, dynamic>> _programs() {
    final raw = widget.localStore.read('pace.sport.programs');
    if (raw is! List) return [];
    return raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }

  List<Map<String, dynamic>> _sessions() {
    final raw = widget.localStore.read('pace.sport.sessions');
    if (raw is! List) return [];
    return raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }

  Future<void> _startFree() async {
    final session = {
      'id': DateTime.now().microsecondsSinceEpoch.toString(),
      'date': _today(),
      'name': 'Séance libre',
      'startedAt': DateTime.now().millisecondsSinceEpoch,
      'exercises': <dynamic>[],
    };
    await widget.localStore.write('pace.sport.active', session);
    if (mounted) setState(() {});
  }

  Future<void> _finish() async {
    final raw = widget.localStore.read('pace.sport.active');
    if (raw is! Map) return;
    final session = Map<String, dynamic>.from(raw);
    final ended = DateTime.now().millisecondsSinceEpoch;
    session['endedAt'] = ended;
    session['durationMin'] = ((ended - ((session['startedAt'] as num?)?.toInt() ?? ended)) / 60000).round();
    final sessions = _sessions();
    sessions.insert(0, session);
    await widget.localStore.write('pace.sport.sessions', sessions);
    await widget.localStore.remove('pace.sport.active');
    if (mounted) setState(() {});
  }

  Future<void> _addExercise() async {
    final name = TextEditingController();
    final muscle = TextEditingController();
    final result = await showDialog<Map<String, String>>(
      context: context,
      builder: (context) => AlertDialog(title: const Text('Nouvel exercice'), content: Column(mainAxisSize: MainAxisSize.min, children: [TextField(controller: name, autofocus: true, decoration: const InputDecoration(labelText: 'Nom')), TextField(controller: muscle, decoration: const InputDecoration(labelText: 'Muscle'))]), actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Annuler')), FilledButton(onPressed: () => Navigator.pop(context, {'name': name.text.trim(), 'muscle': muscle.text.trim()}), child: const Text('Ajouter'))]),
    );
    name.dispose();
    muscle.dispose();
    if (result == null || result['name']!.isEmpty) return;
    final exercises = _exercises();
    exercises.add({'id': DateTime.now().microsecondsSinceEpoch.toString(), 'name': result['name'], 'muscle': result['muscle'] ?? ''});
    await widget.localStore.write('pace.sport.exercises', exercises);
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final active = widget.localStore.read('pace.sport.active');
    final exercises = _exercises();
    final programs = _programs();
    final sessions = _sessions();
    return ListView(padding: const EdgeInsets.all(20), children: [
      Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text('Sport', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700)), IconButton(onPressed: _addExercise, icon: const Icon(Icons.add))]),
      const SizedBox(height: 12),
      if (active is Map) PaceGlassCard(child: ListTile(leading: const Icon(Icons.play_circle_outline), title: Text(active['name']?.toString() ?? 'Séance'), subtitle: const Text('Séance en cours'), trailing: FilledButton(onPressed: _finish, child: const Text('Terminer')))),
      if (active is! Map) PaceGlassCard(child: ListTile(leading: const Icon(Icons.fitness_center_outlined), title: const Text('Séance libre'), subtitle: const Text('Démarre une séance sans programme'), trailing: FilledButton(onPressed: _startFree, child: const Text('Démarrer')))),
      const SizedBox(height: 14),
      Text('Programmes', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
      const SizedBox(height: 8),
      if (programs.isEmpty) const PaceGlassCard(child: ListTile(title: Text('Aucun programme configuré'))),
      for (final program in programs) Padding(padding: const EdgeInsets.only(bottom: 8), child: PaceGlassCard(child: ListTile(title: Text(program['name']?.toString() ?? 'Programme'), subtitle: Text('${(program['items'] as List?)?.length ?? 0} exercices')))),
      const SizedBox(height: 14),
      Text('Exercices', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
      const SizedBox(height: 8),
      if (exercises.isEmpty) const PaceGlassCard(child: ListTile(title: Text('Aucun exercice'))),
      for (final exercise in exercises) Padding(padding: const EdgeInsets.only(bottom: 8), child: PaceGlassCard(child: ListTile(title: Text(exercise['name']?.toString() ?? 'Exercice'), subtitle: Text(exercise['muscle']?.toString() ?? '')))),
      const SizedBox(height: 14),
      Text('Historique', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
      const SizedBox(height: 8),
      if (sessions.isEmpty) const PaceGlassCard(child: ListTile(title: Text('Aucune séance terminée'))),
      for (final session in sessions.take(10)) Padding(padding: const EdgeInsets.only(bottom: 8), child: PaceGlassCard(child: ListTile(title: Text(session['name']?.toString() ?? 'Séance'), subtitle: Text('${session['date'] ?? ''} · ${session['durationMin'] ?? 0} min')))),
    ]);
  }
}
