import 'package:flutter/material.dart';

import '../../core/storage/local_store.dart';
import '../../ui/pace_theme.dart';

class NutritionPage extends StatefulWidget {
  const NutritionPage({super.key, required this.localStore});

  final LocalStore localStore;

  @override
  State<NutritionPage> createState() => _NutritionPageState();
}

class _NutritionPageState extends State<NutritionPage> {
  String _todayKey() {
    final now = DateTime.now();
    return '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
  }

  Map<String, dynamic> _totals() {
    final raw = widget.localStore.read('pace.nutrition.totals');
    if (raw is! Map) return <String, dynamic>{};
    final value = raw[_todayKey()];
    return value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
  }

  List<Map<String, dynamic>> _items() {
    final raw = widget.localStore.read('pace.nutrition.items');
    if (raw is! Map) return <Map<String, dynamic>>[];
    final value = raw[_todayKey()];
    if (value is! List) return <Map<String, dynamic>>[];
    return value.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }

  double? _parseOptional(TextEditingController controller) {
    final text = controller.text.trim();
    if (text.isEmpty) return null;
    return double.tryParse(text.replaceAll(',', '.'));
  }

  Future<void> _addFood() async {
    final name = TextEditingController();
    final kcal = TextEditingController();
    final protein = TextEditingController();
    final carbs = TextEditingController();
    final fat = TextEditingController();
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Ajouter un aliment'),
        content: SingleChildScrollView(child: Column(children: [
          TextField(controller: name, decoration: const InputDecoration(labelText: 'Aliment')),
          TextField(controller: kcal, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Calories (kcal)')),
          TextField(controller: protein, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Protéines (g)')),
          TextField(controller: carbs, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Glucides (g)')),
          TextField(controller: fat, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Lipides (g)')),
        ])),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Annuler')),
          FilledButton(onPressed: () {
            if (name.text.trim().isEmpty) return;
            final values = <String, dynamic>{
              'kcal': _parseOptional(kcal),
              'p': _parseOptional(protein),
              'c': _parseOptional(carbs),
              'f': _parseOptional(fat),
            };
            if (values.values.any((value) => value is double && value.isNaN)) return;
            Navigator.pop(context, values);
          }, child: const Text('Ajouter')),
        ],
      ),
    );
    final itemName = name.text.trim();
    name.dispose();
    kcal.dispose();
    protein.dispose();
    carbs.dispose();
    fat.dispose();
    if (result == null || itemName.isEmpty) return;

    final raw = widget.localStore.read('pace.nutrition.items');
    final data = Map<String, dynamic>.from(raw is Map ? raw : <String, dynamic>{});
    final day = _todayKey();
    final list = data[day] is List ? List<dynamic>.from(data[day] as List) : <dynamic>[];
    list.add({
      'id': DateTime.now().microsecondsSinceEpoch.toString(),
      'name': itemName,
      'meal': 'Repas',
      'qty': 1,
      ...result,
    });
    data[day] = list;
    await widget.localStore.write('pace.nutrition.items', data);
    await _recalculateTotals(data);
    if (mounted) setState(() {});
  }

  Future<void> _recalculateTotals(Map<String, dynamic> data) async {
    final totals = <String, dynamic>{};
    for (final entry in data.entries) {
      if (entry.value is! List) continue;
      var dayKcal = 0.0, dayP = 0.0, dayC = 0.0, dayF = 0.0;
      var hasKcal = false, hasP = false, hasC = false, hasF = false;
      for (final item in entry.value as List) {
        if (item is! Map) continue;
        final kcal = item['kcal'];
        final p = item['p'];
        final c = item['c'];
        final f = item['f'];
        if (kcal is num) { dayKcal += kcal.toDouble(); hasKcal = true; }
        if (p is num) { dayP += p.toDouble(); hasP = true; }
        if (c is num) { dayC += c.toDouble(); hasC = true; }
        if (f is num) { dayF += f.toDouble(); hasF = true; }
      }
      totals[entry.key.toString()] = {
        'kcal': hasKcal ? dayKcal : null,
        'p': hasP ? dayP : null,
        'c': hasC ? dayC : null,
        'f': hasF ? dayF : null,
      };
    }
    await widget.localStore.write('pace.nutrition.totals', totals);
  }

  Future<void> _deleteItem(Map<String, dynamic> item) async {
    final raw = widget.localStore.read('pace.nutrition.items');
    if (raw is! Map) return;
    final data = Map<String, dynamic>.from(raw);
    final day = _todayKey();
    final list = data[day] is List ? List<dynamic>.from(data[day] as List) : <dynamic>[];
    final before = list.length;
    list.removeWhere((entry) => entry is Map && entry['id']?.toString() == item['id']?.toString());
    if (list.length == before) return;
    data[day] = list;
    await widget.localStore.write('pace.nutrition.items', data);
    await _recalculateTotals(data);
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final totals = _totals();
    final items = _items();
    String number(String key) {
      final value = totals[key];
      return value is num ? value.toStringAsFixed(1) : '—';
    }
    return RefreshIndicator(
      onRefresh: () async => setState(() {}),
      child: ListView(padding: const EdgeInsets.all(20), children: [
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Text('Nutrition', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700)),
          IconButton(onPressed: _addFood, icon: const Icon(Icons.add_circle_outline), tooltip: 'Ajouter un aliment'),
        ]),
        const SizedBox(height: 6),
        Text('Données réelles de ton journal Pace', style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
        const SizedBox(height: 18),
        PaceGlassCard(child: Column(children: [
          _NutritionRow('Calories', '${number('kcal')} kcal', Icons.local_fire_department_outlined),
          _NutritionRow('Protéines', '${number('p')} g', Icons.fitness_center_outlined),
          _NutritionRow('Glucides', '${number('c')} g', Icons.grain_outlined),
          _NutritionRow('Lipides', '${number('f')} g', Icons.opacity_outlined),
        ])),
        const SizedBox(height: 14),
        Text('Repas du jour', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        if (items.isEmpty) const PaceGlassCard(child: ListTile(title: Text('Aucun aliment enregistré aujourd’hui'))),
        for (final item in items)
          Padding(padding: const EdgeInsets.only(bottom: 8), child: PaceGlassCard(child: ListTile(
            contentPadding: const EdgeInsets.symmetric(horizontal: 14),
            title: Text(item['name']?.toString() ?? 'Aliment'),
            subtitle: Text('${item['meal'] ?? 'Repas'} · ${item['kcal'] is num ? (item['kcal'] as num).toStringAsFixed(0) : '—'} kcal · P ${item['p'] is num ? (item['p'] as num).toStringAsFixed(1) : '—'} g'),
            trailing: IconButton(onPressed: () => _deleteItem(item), icon: const Icon(Icons.delete_outline)),
          ))),
      ]),
    );
  }
}

class _NutritionRow extends StatelessWidget {
  const _NutritionRow(this.label, this.value, this.icon);
  final String label;
  final String value;
  final IconData icon;

  @override
  Widget build(BuildContext context) => ListTile(contentPadding: EdgeInsets.zero, leading: Icon(icon), title: Text(label), trailing: Text(value, style: const TextStyle(fontWeight: FontWeight.w700)));
}
