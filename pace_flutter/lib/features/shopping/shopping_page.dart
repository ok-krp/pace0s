import 'package:flutter/material.dart';

import '../../core/storage/local_store.dart';
import '../../ui/pace_theme.dart';

class ShoppingPage extends StatefulWidget {
  const ShoppingPage({super.key, required this.localStore});
  final LocalStore localStore;

  @override
  State<ShoppingPage> createState() => _ShoppingPageState();
}

class _ShoppingPageState extends State<ShoppingPage> {
  List<Map<String, dynamic>> _items() {
    final raw = widget.localStore.read('pace.shopping');
    if (raw is! List) return [];
    return raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  }

  Future<void> _add() async {
    final name = TextEditingController();
    final quantity = TextEditingController(text: '1');
    final result = await showDialog<Map<String, String>>(context: context, builder: (context) => AlertDialog(title: const Text('Ajouter à la liste'), content: Column(mainAxisSize: MainAxisSize.min, children: [TextField(controller: name, autofocus: true, decoration: const InputDecoration(labelText: 'Produit')), TextField(controller: quantity, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Quantité'))]), actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Annuler')), FilledButton(onPressed: () => Navigator.pop(context, {'name': name.text.trim(), 'quantity': quantity.text.trim()}), child: const Text('Ajouter'))]));
    name.dispose();
    quantity.dispose();
    if (result == null || result['name']!.isEmpty) return;
    final items = _items();
    items.add({'id': DateTime.now().microsecondsSinceEpoch.toString(), 'name': result['name'], 'quantity': result['quantity'], 'checked': false});
    await widget.localStore.write('pace.shopping', items);
    if (mounted) setState(() {});
  }

  Future<void> _toggle(Map<String, dynamic> item) async {
    final items = _items();
    final index = items.indexWhere((e) => e['id']?.toString() == item['id']?.toString());
    if (index < 0) return;
    items[index]['checked'] = !(items[index]['checked'] == true);
    await widget.localStore.write('pace.shopping', items);
    if (mounted) setState(() {});
  }

  Future<void> _delete(Map<String, dynamic> item) async {
    final items = _items()..removeWhere((e) => e['id']?.toString() == item['id']?.toString());
    await widget.localStore.write('pace.shopping', items);
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final items = _items();
    return ListView(padding: const EdgeInsets.all(20), children: [
      Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text('Courses', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700)), IconButton(onPressed: _add, icon: const Icon(Icons.add))]),
      const SizedBox(height: 14),
      if (items.isEmpty) const PaceGlassCard(child: ListTile(title: Text('Liste vide'))),
      for (final item in items) Padding(padding: const EdgeInsets.only(bottom: 8), child: PaceGlassCard(child: ListTile(leading: Checkbox(value: item['checked'] == true, onChanged: (_) => _toggle(item)), title: Text(item['name']?.toString() ?? 'Produit'), subtitle: Text('Quantité : ${item['quantity'] ?? 1}'), trailing: IconButton(onPressed: () => _delete(item), icon: const Icon(Icons.delete_outline))))),
    ]);
  }
}
