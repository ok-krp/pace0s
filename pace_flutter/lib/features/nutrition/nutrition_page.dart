import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';

import '../../core/storage/local_store.dart';
import '../../core/sync/sync_service.dart';
import '../../core/sync/food_log_sync.dart';
import '../../ui/pace_theme.dart';

class NutritionPage extends StatefulWidget {
  const NutritionPage({super.key, required this.localStore, required this.sync});

  final LocalStore localStore;
  final SyncService sync;

  @override
  State<NutritionPage> createState() => _NutritionPageState();
}

class _NutritionPageState extends State<NutritionPage> {
  late String? _accountUserId;
  bool _foodDialogOpen = false;
  Timer? _foodLogRefreshTimer;

  @override
  void initState() {
    super.initState();
    _accountUserId = widget.localStore.activeUserId;
    widget.localStore.addListener(_onLocalStoreChanged);
    unawaited(_pushAndRefreshFoodLog(syncUserState: true));
    _foodLogRefreshTimer = Timer.periodic(
      const Duration(minutes: 1),
      (_) => unawaited(_pushAndRefreshFoodLog()),
    );
  }

  void _onLocalStoreChanged() {
    if (!mounted) return;
    // LocalStore is reused across sign-in/sign-out. Refresh the write scope
    // when its account-switch notification arrives; otherwise the page keeps
    // the previous account ID and all future scoped nutrition writes are
    // safely discarded by LocalStore.
    final activeUserId = widget.localStore.activeUserId;
    _accountUserId = activeUserId;
    // A modal food form may be open above this page. Avoid rebuilding the
    // page underneath its route during an account-scope switch; refresh once
    // the dialog closes. The dialog still validates its captured account ID.
    if (_foodDialogOpen) return;
    setState(() {});
  }

  @override
  void didUpdateWidget(covariant NutritionPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.localStore != widget.localStore) {
      oldWidget.localStore.removeListener(_onLocalStoreChanged);
      _accountUserId = widget.localStore.activeUserId;
      widget.localStore.addListener(_onLocalStoreChanged);
    }
  }

  @override
  void dispose() {
    _foodLogRefreshTimer?.cancel();
    widget.localStore.removeListener(_onLocalStoreChanged);
    super.dispose();
  }

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

  String _newFoodLogId() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes.map((value) => value.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}';
  }

  Future<void> _pushAndRefreshFoodLog({bool syncUserState = false}) async {
    final expectedUserId = _accountUserId;
    if (expectedUserId == null ||
        widget.localStore.isSwitchingAccount ||
        widget.localStore.activeUserId != expectedUserId) {
      return;
    }
    if (syncUserState) await widget.sync.syncNow();
    if (!mounted ||
        widget.localStore.isSwitchingAccount ||
        widget.localStore.activeUserId != expectedUserId) {
      return;
    }
    await FoodLogSync.pushPending(
      client: widget.sync.client,
      localStore: widget.localStore,
      expectedUserId: expectedUserId,
    );
    await _refreshFoodLog();
  }

  Future<void> _refreshFoodLog() async {
    final expectedUserId = _accountUserId;
    if (expectedUserId == null ||
        widget.localStore.isSwitchingAccount ||
        widget.localStore.activeUserId != expectedUserId) {
      return;
    }
    final day = _todayKey();
    final previousCursor = FoodLogSync.parseFoodLogCursor(
      widget.localStore.read(FoodLogSync.cursorKey),
      logDate: day,
    );
    final fullReconciliation = FoodLogSync.shouldRunFullFoodLogReconciliation(
      cursor: previousCursor,
      logDate: day,
    );
    final deltaSince = fullReconciliation || previousCursor == null
        ? null
        : FoodLogSync.foodLogDeltaSince(previousCursor);
    final rows = await FoodLogSync.fetchForDay(
      client: widget.sync.client,
      localStore: widget.localStore,
      expectedUserId: expectedUserId,
      logDate: day,
      createdAtSince: deltaSince,
    );
    if (rows == null ||
        !mounted ||
        widget.localStore.isSwitchingAccount ||
        widget.localStore.activeUserId != expectedUserId ||
        _todayKey() != day) {
      return;
    }
    // Retain any pre-existing legacy user_state mutation until that command
    // is acknowledged. New additions/deletions use the relational outbox.
    if (widget.localStore.hasPendingOperationForKey('pace.nutrition.items')) {
      return;
    }

    final raw = widget.localStore.read('pace.nutrition.items');
    final data = Map<String, dynamic>.from(raw is Map ? raw : <String, dynamic>{});
    final localRaw = data[day];
    final localItems = localRaw is List
        ? localRaw.whereType<Map>().map((item) => Map<String, dynamic>.from(item)).toList()
        : <Map<String, dynamic>>[];
    final deletedIds = <String>{
      ...FoodLogSync.pendingDeletes(widget.localStore),
      ...FoodLogSync.activeDeletedIds(
        widget.localStore.read(FoodLogSync.deletedIdsKey),
      ),
    };
    final remoteItems = rows
        .where((row) => !deletedIds.contains(row['id']?.toString()))
        .map(FoodLogSync.mapFoodLogRowToNutritionItem)
        .toList();
    final List<Map<String, dynamic>> merged;
    if (fullReconciliation) {
      final remoteIds = remoteItems.map((item) => item['id']?.toString()).toSet();
      final legacyOrPending = localItems.where((item) {
        final id = item['id']?.toString() ?? '';
        return !deletedIds.contains(id) &&
            !remoteIds.contains(id) &&
            item['__foodLogCanonical'] != true;
      });
      merged = <Map<String, dynamic>>[
        ...remoteItems,
        ...legacyOrPending,
      ];
    } else {
      merged = FoodLogSync.mergeCanonicalDelta(
        localItems: localItems,
        remoteItems: remoteItems,
        deletedIds: deletedIds,
      );
    }

    final nextCursor = FoodLogSync.nextFoodLogCursor(
      previous: previousCursor,
      rows: rows,
      logDate: day,
      fullReconciliation: fullReconciliation,
    );
    data[day] = merged;
    await widget.localStore.writeBatchForAccount(
      expectedUserId,
      writes: {
        'pace.nutrition.items': data,
        'pace.nutrition.totals': _calculateTotals(data),
        FoodLogSync.cursorKey: nextCursor,
      },
      localOnlyKeys: const {FoodLogSync.cursorKey},
      enqueueSync: false,
    );
    if (mounted &&
        !widget.localStore.isSwitchingAccount &&
        widget.localStore.activeUserId == expectedUserId) {
      setState(() {});
    }
  }

  Future<void> _addFood() async {
    // Capture the initiating account before the dialog can outlive a switch.
    final expectedUserId = _accountUserId;
    final name = TextEditingController();
    final kcal = TextEditingController();
    final protein = TextEditingController();
    final carbs = TextEditingController();
    final fat = TextEditingController();
    _foodDialogOpen = true;
    Map<String, dynamic>? result;
    try {
      result = await showDialog<Map<String, dynamic>>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Ajouter un aliment'),
          content: SingleChildScrollView(
            child: Column(
              children: [
                TextField(controller: name, decoration: const InputDecoration(labelText: 'Aliment')),
                TextField(controller: kcal, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Calories (kcal)')),
                TextField(controller: protein, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Protéines (g)')),
                TextField(controller: carbs, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Glucides (g)')),
                TextField(controller: fat, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Lipides (g)')),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: const Text('Annuler')),
            FilledButton(
              onPressed: () {
                if (name.text.trim().isEmpty) return;
                final numericInputs = [kcal, protein, carbs, fat];
                final hasInvalidNumber = numericInputs.any((controller) {
                  final text = controller.text.trim();
                  if (text.isEmpty) return false;
                  final value = double.tryParse(text.replaceAll(',', '.'));
                  return value == null || !value.isFinite || value < 0;
                });
                if (hasInvalidNumber) return;

                final values = <String, dynamic>{
                  'kcal': _parseOptional(kcal),
                  'p': _parseOptional(protein),
                  'c': _parseOptional(carbs),
                  'f': _parseOptional(fat),
                };
                Navigator.pop(context, values);
              },
              child: const Text('Ajouter'),
            ),
          ],
        ),
      );
    } finally {
      // Keep the page stable through the reverse transition. Rebuilding the
      // parent or disposing controllers too early can break the root Overlay.
      await Future<void>.delayed(const Duration(milliseconds: 350));
      _foodDialogOpen = false;
      if (mounted) setState(() {});
    }
    final itemName = name.text.trim();
    name.dispose();
    kcal.dispose();
    protein.dispose();
    carbs.dispose();
    fat.dispose();
    if (result == null ||
        itemName.isEmpty ||
        widget.localStore.isSwitchingAccount ||
        widget.localStore.activeUserId != expectedUserId) {
      return;
    }

    final raw = widget.localStore.read('pace.nutrition.items');
    final data = Map<String, dynamic>.from(raw is Map ? raw : <String, dynamic>{});
    final day = _todayKey();
    final list = data[day] is List ? List<dynamic>.from(data[day] as List) : <dynamic>[];
    final id = expectedUserId == null
        ? DateTime.now().microsecondsSinceEpoch.toString()
        : _newFoodLogId();
    final item = <String, dynamic>{
      'id': id,
      'name': itemName,
      'meal': 'Repas',
      'qty': 1,
      ...result,
    };
    list.add(item);
    data[day] = list;
    final writes = <String, dynamic>{
      'pace.nutrition.items': data,
      'pace.nutrition.totals': _calculateTotals(data),
    };
    final localOnlyKeys = <String>{};
    if (expectedUserId != null) {
      final values = result;
      try {
        writes[FoodLogSync.outboxKey] = FoodLogSync.queueOperation(
          widget.localStore.read(FoodLogSync.outboxKey),
          operation: 'upsert',
          id: id,
          expectedUserId: expectedUserId,
          row: {
            'id': id,
            'user_id': expectedUserId,
            'log_date': day,
            'meal': 'Repas',
            'name': itemName,
            'kcal': values['kcal'] ?? 0,
            'protein_g': values['p'] ?? 0,
            'carbs_g': values['c'] ?? 0,
            'fat_g': values['f'] ?? 0,
            'fiber_g': 0,
            'sugar_g': 0,
            'sodium_mg': 0,
            'source': 'manual',
            'meta': {
              'client': 'pace_flutter',
              'missing_nutrients': [
                if (values['kcal'] == null) 'kcal',
                if (values['p'] == null) 'protein_g',
                if (values['c'] == null) 'carbs_g',
                if (values['f'] == null) 'fat_g',
              ],
            },
          },
          now: DateTime.now().toUtc(),
        );
      } on StateError catch (error) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(error.message)),
          );
        }
        return;
      }
      localOnlyKeys.addAll({
        FoodLogSync.outboxKey,
        'pace.nutrition.items',
        'pace.nutrition.totals',
      });
    }
    await widget.localStore.writeBatchForAccount(
      expectedUserId,
      writes: writes,
      localOnlyKeys: localOnlyKeys,
    );
    if (mounted &&
        !widget.localStore.isSwitchingAccount &&
        widget.localStore.activeUserId == expectedUserId) {
      setState(() {});
    }
  }

  Map<String, dynamic> _calculateTotals(Map<String, dynamic> data) {
    final totals = <String, dynamic>{};
    for (final entry in data.entries) {
      final rawItems = entry.value;
      if (rawItems is! List) continue;
      var dayKcal = 0.0, dayP = 0.0, dayC = 0.0, dayF = 0.0;
      var hasKcal = false, hasP = false, hasC = false, hasF = false;
      for (final item in rawItems) {
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
    return totals;
  }

  Future<void> _deleteItem(Map<String, dynamic> item) async {
    final expectedUserId = _accountUserId;
    if (widget.localStore.isSwitchingAccount ||
        widget.localStore.activeUserId != expectedUserId) {
      return;
    }
    final raw = widget.localStore.read('pace.nutrition.items');
    if (raw is! Map) return;
    final data = Map<String, dynamic>.from(raw);
    final day = _todayKey();
    final list = data[day] is List ? List<dynamic>.from(data[day] as List) : <dynamic>[];
    final before = list.length;
    final itemId = item['id']?.toString() ?? '';
    list.removeWhere((entry) => entry is Map && entry['id']?.toString() == itemId);
    if (list.length == before) return;
    data[day] = list;
    final writes = <String, dynamic>{
      'pace.nutrition.items': data,
      'pace.nutrition.totals': _calculateTotals(data),
    };
    final localOnlyKeys = <String>{};
    if (expectedUserId != null && FoodLogSync.isUuid(itemId)) {
      final now = DateTime.now().toUtc();
      try {
        writes[FoodLogSync.outboxKey] = FoodLogSync.queueOperation(
          widget.localStore.read(FoodLogSync.outboxKey),
          operation: 'delete',
          id: itemId,
          expectedUserId: expectedUserId,
          now: now,
        );
        // The SQL outbox remains local and durable; the compact tombstone is a
        // normal account-scoped user_state key so other devices can hide a
        // deleted cached item even before their next SQL reconciliation.
        writes[FoodLogSync.deletedIdsKey] = FoodLogSync.queueDeletedId(
          widget.localStore.read(FoodLogSync.deletedIdsKey),
          id: itemId,
          now: now,
        );
      } on StateError catch (error) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(error.message)),
          );
        }
        return;
      }
      localOnlyKeys.addAll({
        FoodLogSync.outboxKey,
        'pace.nutrition.items',
        'pace.nutrition.totals',
      });
    }
    await widget.localStore.writeBatchForAccount(
      expectedUserId,
      writes: writes,
      localOnlyKeys: localOnlyKeys,
    );
    if (expectedUserId != null) {
      unawaited(_pushAndRefreshFoodLog(syncUserState: true));
    }
    if (mounted &&
        !widget.localStore.isSwitchingAccount &&
        widget.localStore.activeUserId == expectedUserId) {
      setState(() {});
    }
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
      onRefresh: _refreshFoodLog,
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
