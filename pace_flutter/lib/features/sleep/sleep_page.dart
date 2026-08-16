import 'package:flutter/material.dart';

import '../../core/storage/local_store.dart';
import '../../ui/pace_theme.dart';

class SleepPage extends StatefulWidget {
  const SleepPage({super.key, required this.localStore});
  final LocalStore localStore;

  @override
  State<SleepPage> createState() => _SleepPageState();
}

class _SleepPageState extends State<SleepPage> {
  String _day(DateTime date) => '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

  Map<String, dynamic> _data() {
    final raw = widget.localStore.read('pace.sleep');
    return Map<String, dynamic>.from(raw is Map ? raw : <String, dynamic>{});
  }

  double _hours(dynamic value) {
    if (value is num) return value.toDouble();
    if (value is Map && value['hours'] is num) return (value['hours'] as num).toDouble();
    return 0;
  }

  Future<void> _edit(String day) async {
    final data = _data();
    final controller = TextEditingController(text: _hours(data[day]).toStringAsFixed(2));
    final value = await showDialog<double>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(day == _day(DateTime.now()) ? 'Sommeil aujourd’hui' : 'Sommeil du $day'),
        content: TextField(controller: controller, autofocus: true, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Durée en heures')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Annuler')),
          FilledButton(onPressed: () { final v = double.tryParse(controller.text.replaceAll(',', '.')); if (v != null && v >= 0 && v <= 24) Navigator.pop(context, v); }, child: const Text('Enregistrer')),
        ],
      ),
    );
    controller.dispose();
    if (value == null) return;
    data[day] = {'hours': value};
    await widget.localStore.write('pace.sleep', data);
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final data = _data();
    final days = List.generate(7, (index) => DateTime.now().subtract(Duration(days: 6 - index)));
    final today = _day(DateTime.now());
    return RefreshIndicator(
      onRefresh: () async => setState(() {}),
      child: ListView(padding: const EdgeInsets.all(20), children: [
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Text('Sommeil', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700)),
          IconButton(onPressed: () => _edit(today), icon: const Icon(Icons.edit_outlined)),
        ]),
        const SizedBox(height: 14),
        PaceGlassCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Aujourd’hui', style: Theme.of(context).textTheme.labelSmall?.copyWith(letterSpacing: 1.6)),
          const SizedBox(height: 8),
          Text('${_hours(data[today]).toStringAsFixed(2)} h', style: Theme.of(context).textTheme.displaySmall?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text('${(_hours(data[today]) * 60).round() ~/ 60}h${((_hours(data[today]) * 60).round() % 60).toString().padLeft(2, '0')}'),
        ])),
        const SizedBox(height: 14),
        Text('Historique 7 jours', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        for (final date in days.reversed)
          Padding(padding: const EdgeInsets.only(bottom: 8), child: PaceGlassCard(child: ListTile(
            contentPadding: const EdgeInsets.symmetric(horizontal: 14),
            title: Text(_day(date)),
            trailing: Text('${_hours(data[_day(date)]).toStringAsFixed(2)} h', style: const TextStyle(fontWeight: FontWeight.w700)),
            onTap: () => _edit(_day(date)),
          ))),
      ]),
    );
  }
}
