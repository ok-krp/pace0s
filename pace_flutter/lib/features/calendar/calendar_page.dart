import 'package:flutter/material.dart';

import '../../core/storage/local_store.dart';
import '../../ui/pace_theme.dart';

class CalendarPage extends StatefulWidget {
  const CalendarPage({super.key, required this.localStore});
  final LocalStore localStore;

  @override
  State<CalendarPage> createState() => _CalendarPageState();
}

class _CalendarPageState extends State<CalendarPage> {
  late String? _accountUserId;
  bool _dialogOpen = false;
  @override
  void initState() {
    super.initState();
    _accountUserId = widget.localStore.activeUserId;
    widget.localStore.addListener(_onLocalStoreChanged);
  }

  void _onLocalStoreChanged() {
    if (!mounted) return;
    final activeUserId = widget.localStore.activeUserId;
    if (activeUserId != _accountUserId) _accountUserId = activeUserId;
    if (_dialogOpen) return;
    setState(() {});
  }

  @override
  void didUpdateWidget(covariant CalendarPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.localStore != widget.localStore) {
      oldWidget.localStore.removeListener(_onLocalStoreChanged);
      _accountUserId = widget.localStore.activeUserId;
      widget.localStore.addListener(_onLocalStoreChanged);
    }
  }

  @override
  void dispose() {
    widget.localStore.removeListener(_onLocalStoreChanged);
    super.dispose();
  }

  List<Map<String, dynamic>> _events() {
    final raw = widget.localStore.read('pace.calendar.events');
    if (raw is! List) return [];
    return raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }

  Future<void> _add() async {
    final expectedUserId = _accountUserId;
    final title = TextEditingController();
    final date = TextEditingController(
      text: DateTime.now().toIso8601String().substring(0, 10),
    );
    Map<String, String>? result;
    _dialogOpen = true;
    try {
      result = await showDialog<Map<String, String>>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Nouvel évènement'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: title,
                autofocus: true,
                decoration: const InputDecoration(labelText: 'Titre'),
              ),
              TextField(
                controller: date,
                decoration: const InputDecoration(labelText: 'Date (AAAA-MM-JJ)'),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Annuler'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, {
                'title': title.text.trim(),
                'date': date.text.trim(),
              }),
              child: const Text('Créer'),
            ),
          ],
        ),
      );
    } finally {
      await Future<void>.delayed(const Duration(milliseconds: 350));
      _dialogOpen = false;
      title.dispose();
      date.dispose();
      if (mounted) setState(() {});
    }
    if (result == null ||
        result['title']!.isEmpty ||
        widget.localStore.activeUserId != expectedUserId) {
      return;
    }
    final events = _events();
    events.add({
      'id': DateTime.now().microsecondsSinceEpoch.toString(),
      ...result,
    });
    await widget.localStore.writeForAccount(
      expectedUserId,
      'pace.calendar.events',
      events,
    );
    if (mounted) setState(() {});
  }

  Future<void> _delete(Map<String, dynamic> event) async {
    final expectedUserId = _accountUserId;
    final events = _events()..removeWhere((e) => e['id']?.toString() == event['id']?.toString());
    await widget.localStore.writeForAccount(expectedUserId, 'pace.calendar.events', events);
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final events = _events()..sort((a, b) => (a['date']?.toString() ?? '').compareTo(b['date']?.toString() ?? ''));
    return ListView(padding: const EdgeInsets.all(20), children: [
      Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text('Calendrier', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700)), IconButton(onPressed: _add, icon: const Icon(Icons.add))]),
      const SizedBox(height: 14),
      if (events.isEmpty) const PaceGlassCard(child: ListTile(title: Text('Aucun évènement'))),
      for (final event in events)
        Padding(padding: const EdgeInsets.only(bottom: 8), child: PaceGlassCard(child: ListTile(title: Text(event['title']?.toString() ?? 'Évènement'), subtitle: Text(event['date']?.toString() ?? ''), trailing: IconButton(onPressed: () => _delete(event), icon: const Icon(Icons.delete_outline))))),
    ]);
  }
}
