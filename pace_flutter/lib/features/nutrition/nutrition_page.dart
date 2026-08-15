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

  Future<void> _addFood() async {
    final name = TextEditingController();
    final kcal = TextEditingController();
    final protein = TextEditingController();
    final carbs = TextEditingController();
    final fat = TextEditingController();
    final result = await showDialog<Map<String, double>>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Ajouter un aliment'),
        content: SingleChildScrollView(child: Column(children: [
          TextField(controller: name, decoration: const InputDecoration(labelText: 'Aliment')),
          TextField(controller: kcal, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Calories (kcal)')),
          TextField(controller: protein, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Protéines (g)')),
          TextField(controller: carbs, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Glucides (g)')),
          TextField(controller: fat, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Lipides (g)')),
        ])),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Annuler')),
          FilledButton(onPressed: () {
            if (name.text.trim().isEmpty) return;
            Navigator.pop(context, {
              'kcal': double.tryParse(kcal.text.replaceAll(',', '.')) ?? 0,
              'p': double.tryParse(protein.text.replaceAll(',', '.')) ?? 0,
              'c': double.tryParse(carbs.text.replaceAll(',', '.')) ?? 0,
              'f': double.tryParse(fat.text.replaceAll(',', '.')) ?? 0,
            });
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
    final totals = <String, dynamic>{};
    for (final entry in data.entries) {
      if (entry.value is! List) continue;
      var dayKcal = 0.0, dayP = 0.0, dayC = 0.0, dayF = 0.0;
      for (final item in entry.value as List) {
        if (item is Map) {
          dayKcal += (item['kcal'] as num?)?.toDouble() ?? 0;
          dayP += (item['p'] as num?)?.toDouble() ?? 0;
          dayC += (item['c'] as num?)?.toDouble() ?? 0;
          dayF += (item['f'] as num?)?.toDouble() ?? 0;
        }
      }
      totals[entry.key.toString()] = {'kcal': dayKcal, 'p': dayP, 'c': dayC, 'f': dayF};
    }
    await widget.localStore.write('pace.nutrition.items', data);
    await widget.localStore.write('pace.nutrition.totals', totals);
    if (mounted) setState(() {});
  }

  Future<void> _deleteItem(Map<String, dynamic> item) async {
    final raw = widget.localStore.read('pace.nutrition.items');
    if (raw is! Map) return;
    final data = Map<String, dynamic>.from(raw);
    final day = _todayKey();
    final list = data[day] is List ? List<dynamic>.from(data[day] as List) : <dynamic>[];
    list.removeWhere((entry) => entry is Map && entry['id']?.toString() == item['id']?.toString());
    data[day] = list;
    await widget.localStore.write('pace.nutrition.items', data);
    final current = _totals();
    final total = <String, dynamic>{
      'kcal': ((current['kcal'] as num?)?.toDouble() ?? 0) - ((item['kcal'] as num?)?.toDouble() ?? 0),
      'p': ((current['p'] as num?)?.toDouble() ?? 0) - ((item['p'] as num?)?.toDouble() ?? 0),
      'c': ((current['c'] as num?)?.toDouble() ?? 0) - ((item['c'] as num?)?.toDouble() ?? 0),
      'f': ((current['f'] as num?)?.toDouble() ?? 0) - ((item['f'] as num?)?.toDouble() ?? 0),
    };
    final totalsRaw = widget.localStore.read('pace.nutrition.totals');
    final totals = Map<String, dynamic>.from(totalsRaw is Map ? totalsRaw : <String, dynamic>{});
    totals[day] = total;
    await widget.localStore.write('pace.nutrition.totals', totals);
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final totals = _totals();
    final items = _items();
    double number(String key) => (totals[key] as num?)?.toDouble() ?? 0;
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
          _NutritionRow('Calories', '${number('kcal').toStringAsFixed(0)} kcal', Icons.local_fire_department_outlined),
          _NutritionRow('Protéines', '${number('p').toStringAsFixed(1)} g', Icons.fitness_center_outlined),
          _NutritionRow('Glucides', '${number('c').toStringAsFixed(1)} g', Icons.grain_outlined),
          _NutritionRow('Lipides', '${number('f').toStringAsFixed(1)} g', Icons.opacity_outlined),
        ])),
        const SizedBox(height: 14),
        Text('Repas du jour', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        if (items.isEmpty) const PaceGlassCard(child: ListTile(title: Text('Aucun aliment enregistré aujourd’hui'))),
        for (final item in items)
          Padding(padding: const EdgeInsets.only(bottom: 8), child: PaceGlassCard(child: ListTile(
            contentPadding: const EdgeInsets.symmetric(horizontal: 14),
            title: Text(item['name']?.toString() ?? 'Aliment'),
            subtitle: Text('${item['meal'] ?? 'Repas'} · ${(item['kcal'] as num?)?.toStringAsFixed(0) ?? '0'} kcal · P ${(item['p'] as num?)?.toStringAsFixed(1) ?? '0'} g'),
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
