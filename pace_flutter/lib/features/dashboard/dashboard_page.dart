import 'package:flutter/material.dart';

import '../../core/storage/local_store.dart';
import '../../ui/pace_theme.dart';
import 'dashboard_model.dart';

class DashboardPage extends StatefulWidget {
  const DashboardPage({super.key, required this.localStore});

  final LocalStore localStore;

  @override
  State<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends State<DashboardPage> {
  DashboardSnapshot? _snapshot;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final now = DateTime.now();
    final today = dateKey(now);
    final sleep = numberDayMap(widget.localStore.read('pace.sleep'));
    final water = numberDayMap(widget.localStore.read('pace.water'));
    final kcal = <String, double>{};
    final protein = <String, double>{};
    final carbs = <String, double>{};
    final fat = <String, double>{};
    final nutritionRaw = widget.localStore.read('pace.nutrition.totals');
    if (nutritionRaw is Map) {
      for (final entry in nutritionRaw.entries) {
        final value = entry.value;
        if (value is Map) {
          kcal[entry.key.toString()] = (value['kcal'] as num?)?.toDouble() ?? 0;
          protein[entry.key.toString()] = (value['p'] as num?)?.toDouble() ?? 0;
          carbs[entry.key.toString()] = (value['c'] as num?)?.toDouble() ?? 0;
          fat[entry.key.toString()] = (value['f'] as num?)?.toDouble() ?? 0;
        }
      }
    }
    final routines = integerListLengthMap(widget.localStore.read('pace.routine.done'));
    final routineList = widget.localStore.read('pace.routine.list');
    final routineTotal = routineList is List ? routineList.length : 0;
    final focus = numberDayMap(widget.localStore.read('pace.work.minutes'));
    final weight = <String, double>{};
    final weightRaw = widget.localStore.read('pace.weight');
    if (weightRaw is Map) {
      for (final entry in weightRaw.entries) {
        final value = entry.value;
        if (value is Map && value['w'] is num) weight[entry.key.toString()] = (value['w'] as num).toDouble();
        if (value is num) weight[entry.key.toString()] = value.toDouble();
      }
    }
    double income = 0;
    double spend = 0;
    final transactions = widget.localStore.read('pace.tx');
    if (transactions is List) {
      for (final item in transactions) {
        if (item is! Map || item['date']?.toString() != today || item['amount'] is! num) continue;
        final amount = (item['amount'] as num).toDouble();
        if (amount >= 0) {
          income += amount;
        } else {
          spend += -amount;
        }
      }
    }

    final goals = DashboardGoals.fromDynamic(widget.localStore.read('pace.user.goals'));
    final days = lastSevenDays(now);
    if (!mounted) return;
    setState(() {
      _snapshot = DashboardSnapshot(
        today: today,
        sleep: sleep[today] ?? 0,
        waterMl: water[today] ?? 0,
        kcal: kcal[today] ?? 0,
        protein: protein[today] ?? 0,
        carbs: carbs[today] ?? 0,
        fat: fat[today] ?? 0,
        routineDone: routines[today] ?? 0,
        routineTotal: routineTotal,
        focusMinutes: focus[today] ?? 0,
        weight: weight[today],
        income: income,
        spend: spend,
        goals: goals,
        sleepByDay: {for (final d in days) d: sleep[d] ?? 0},
        waterByDay: {for (final d in days) d: water[d] ?? 0},
        kcalByDay: {for (final d in days) d: kcal[d] ?? 0},
        focusByDay: {for (final d in days) d: focus[d] ?? 0},
        routineDoneByDay: {for (final d in days) d: routines[d] ?? 0},
        weightByDay: weight,
      );
    });
  }

  Future<void> _save(String key, dynamic value) async {
    setState(() => _saving = true);
    try {
      await widget.localStore.write(key, value);
      await _load();
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _addWater() async {
    final current = numberDayMap(widget.localStore.read('pace.water'));
    final logsRaw = widget.localStore.read('pace.water.log');
    final logs = logsRaw is Map ? Map<String, dynamic>.from(logsRaw) : <String, dynamic>{};
    final day = _snapshot!.today;
    current[day] = (current[day] ?? 0) + 250;
    final dayLogs = logs[day] is List ? List<dynamic>.from(logs[day] as List) : <dynamic>[];
    dayLogs.add(DateTime.now().millisecondsSinceEpoch);
    logs[day] = dayLogs;
    await _save('pace.water', current);
    await _save('pace.water.log', logs);
  }

  Future<void> _editSleep() async {
    final value = await _numberDialog('Sommeil', 'Durée en heures', _snapshot!.sleep.toStringAsFixed(2), min: 0, max: 24);
    if (value == null) return;
    final data = Map<String, dynamic>.from(widget.localStore.read('pace.sleep') is Map ? widget.localStore.read('pace.sleep') as Map : {});
    data[_snapshot!.today] = {'hours': value};
    await _save('pace.sleep', data);
  }

  Future<void> _editWeight() async {
    final value = await _numberDialog('Poids', 'Poids en kg', _snapshot!.weight?.toStringAsFixed(1) ?? '', min: 1, max: 500);
    if (value == null) return;
    final data = Map<String, dynamic>.from(widget.localStore.read('pace.weight') is Map ? widget.localStore.read('pace.weight') as Map : {});
    data[_snapshot!.today] = {'w': value};
    await _save('pace.weight', data);
  }

  Future<void> _editNutrition() async {
    final values = await _nutritionDialog();
    if (values == null) return;
    final raw = widget.localStore.read('pace.nutrition.totals');
    final data = Map<String, dynamic>.from(raw is Map ? raw : {});
    data[_snapshot!.today] = values;
    await _save('pace.nutrition.totals', data);
  }

  Future<void> _editFocus() async {
    final value = await _numberDialog('Focus', 'Minutes aujourd’hui', _snapshot!.focusMinutes.toStringAsFixed(0), min: 0, max: 1440);
    if (value == null) return;
    final data = numberDayMap(widget.localStore.read('pace.work.minutes'));
    data[_snapshot!.today] = value;
    await _save('pace.work.minutes', data);
  }

  Future<void> _toggleRoutine() async {
    final raw = widget.localStore.read('pace.routine.done');
    final data = Map<String, dynamic>.from(raw is Map ? raw : {});
    final day = _snapshot!.today;
    final list = data[day] is List ? List<dynamic>.from(data[day] as List) : <dynamic>[];
    final all = widget.localStore.read('pace.routine.list');
    final firstId = all is List && all.isNotEmpty && all.first is Map ? all.first['id']?.toString() : null;
    if (firstId == null) return;
    if (list.contains(firstId)) {
      list.remove(firstId);
    } else {
      list.add(firstId);
    }
    data[day] = list;
    await _save('pace.routine.done', data);
  }

  Future<double?> _numberDialog(String title, String label, String initial, {required double min, required double max}) async {
    final controller = TextEditingController(text: initial);
    final value = await showDialog<double>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          autofocus: true,
          decoration: InputDecoration(labelText: label),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Annuler')),
          FilledButton(onPressed: () { final parsed = double.tryParse(controller.text.replaceAll(',', '.')); if (parsed != null && parsed >= min && parsed <= max) Navigator.pop(context, parsed); }, child: const Text('Enregistrer')),
        ],
      ),
    );
    controller.dispose();
    return value;
  }

  Future<Map<String, double>?> _nutritionDialog() async {
    final current = <String, double>{'kcal': _snapshot!.kcal, 'p': _snapshot!.protein, 'c': _snapshot!.carbs, 'f': _snapshot!.fat};
    final controllers = {for (final key in current.keys) key: TextEditingController(text: current[key]!.toStringAsFixed(0))};
    final result = await showDialog<Map<String, double>>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Nutrition du jour'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          for (final entry in [('kcal', 'Calories'), ('p', 'Protéines (g)'), ('c', 'Glucides (g)'), ('f', 'Lipides (g)')])
            Padding(padding: const EdgeInsets.only(bottom: 10), child: TextField(controller: controllers[entry.$1], keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: entry.$2))),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Annuler')),
          FilledButton(onPressed: () { final parsed = <String, double>{}; for (final key in current.keys) { final v = double.tryParse(controllers[key]!.text.replaceAll(',', '.')); if (v == null || v < 0) return; parsed[key] = v; } Navigator.pop(context, parsed); }, child: const Text('Enregistrer')),
        ],
      ),
    );
    for (final controller in controllers.values) controller.dispose();
    return result;
  }

  @override
  Widget build(BuildContext context) {
    final snapshot = _snapshot;
    if (snapshot == null) return const Center(child: CircularProgressIndicator());
    final now = DateTime.now();
    final score = snapshot.scoreFor(snapshot.today);
    final days = lastSevenDays(now);
    final average = (days.map(snapshot.scoreFor).fold<int>(0, (a, b) => a + b) / days.length).round();
    final delta = score - average;
    final sleepPct = (snapshot.sleep / 8).clamp(0.0, 1.0);
    final waterPct = (snapshot.waterMl / snapshot.goals.waterMl).clamp(0.0, 1.0);
    final kcalPct = (snapshot.kcal / snapshot.goals.kcal).clamp(0.0, 1.0);
    final routinePct = snapshot.routineRatio.clamp(0.0, 1.0);
    final focusPct = (snapshot.focusMinutes / 240).clamp(0.0, 1.0);

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 28),
        children: [
          Text('${_greeting(now)}', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text(frenchDateLabel(now), style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
          const SizedBox(height: 18),
          Wrap(spacing: 8, runSpacing: 8, children: [
            _QuickButton(icon: Icons.water_drop_outlined, label: 'Eau', onTap: _addWater),
            _QuickButton(icon: Icons.restaurant_outlined, label: 'Repas', onTap: _editNutrition),
            _QuickButton(icon: Icons.bedtime_outlined, label: 'Sommeil', onTap: _editSleep),
            _QuickButton(icon: Icons.monitor_weight_outlined, label: 'Pesée', onTap: _editWeight),
            _QuickButton(icon: Icons.timer_outlined, label: 'Focus', onTap: _editFocus),
          ]),
          const SizedBox(height: 14),
          PaceGlassCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Aujourd’hui', style: Theme.of(context).textTheme.labelSmall?.copyWith(letterSpacing: 1.8, fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            Text('Ton rythme quotidien', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text('${delta >= 0 ? '↑' : '↓'} ${delta.abs()} pts vs moyenne 7 j', style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 20),
            Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
              SizedBox(width: 132, height: 132, child: Stack(alignment: Alignment.center, children: [
                SizedBox(width: 132, height: 132, child: CircularProgressIndicator(value: score / 100, strokeWidth: 11, backgroundColor: Theme.of(context).colorScheme.surfaceContainerHighest)),
                Column(mainAxisSize: MainAxisSize.min, children: [Text('$score', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w800)), Text('/ 100', style: Theme.of(context).textTheme.labelSmall)],),
              ])),
              const SizedBox(width: 18),
              Expanded(child: Column(children: [
                _ProgressMetric(label: 'Sommeil', value: _formatHours(snapshot.sleep), progress: sleepPct),
                _ProgressMetric(label: 'Hydratation', value: '${(snapshot.waterMl / 1000).toStringAsFixed(1)} L', progress: waterPct),
                _ProgressMetric(label: 'Nutrition', value: '${snapshot.kcal.toStringAsFixed(0)} kcal', progress: kcalPct),
                _ProgressMetric(label: 'Routine', value: '${snapshot.routineDone}/${snapshot.routineTotal}', progress: routinePct),
                _ProgressMetric(label: 'Focus', value: '${snapshot.focusMinutes.toStringAsFixed(0)} min', progress: focusPct),
              ])),
            ]),
          ])),
          const SizedBox(height: 12),
          _MetricGrid(snapshot: snapshot, onSleep: _editSleep, onWater: _addWater, onNutrition: _editNutrition, onWeight: _editWeight, onRoutine: _toggleRoutine, onFocus: _editFocus),
          const SizedBox(height: 12),
          PaceGlassCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Tendance 7 jours', style: Theme.of(context).textTheme.labelSmall?.copyWith(letterSpacing: 1.6, fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            Text('Sommeil & hydratation', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 18),
            SizedBox(height: 130, child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [for (final day in days) Expanded(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 3), child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
              Expanded(child: Align(alignment: Alignment.bottomCenter, child: Container(width: 10, height: 100 * (snapshot.sleepByDay[day] ?? 0) / 8, decoration: BoxDecoration(color: Theme.of(context).colorScheme.primary, borderRadius: BorderRadius.circular(8))))),
              const SizedBox(height: 6),
              Text(day.substring(8), style: Theme.of(context).textTheme.labelSmall),
            ])))])),
            const SizedBox(height: 10),
            Text('Barres = durée de sommeil. Les données d’hydratation restent disponibles dans les cartes et dans le stockage local.', style: Theme.of(context).textTheme.bodySmall),
          ])),
          const SizedBox(height: 12),
          PaceGlassCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text('Finances du jour', style: Theme.of(context).textTheme.labelSmall?.copyWith(letterSpacing: 1.6, fontWeight: FontWeight.w600)), Text('Net ${ (snapshot.income - snapshot.spend).toStringAsFixed(2)} €', style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700))]),
            const SizedBox(height: 14),
            Row(children: [Expanded(child: _FinanceValue(label: 'Entrées', value: snapshot.income, icon: Icons.trending_up, positive: true)), const SizedBox(width: 12), Expanded(child: _FinanceValue(label: 'Sorties', value: snapshot.spend, icon: Icons.account_balance_wallet_outlined, positive: false))]),
          ])),
          const SizedBox(height: 12),
          if (snapshot.weightByDay.length > 1)
            PaceGlassCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Évolution du poids', style: Theme.of(context).textTheme.labelSmall?.copyWith(letterSpacing: 1.6, fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              Text(snapshot.weight == null ? 'Aucune pesée aujourd’hui' : '${snapshot.weight!.toStringAsFixed(1)} kg', style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
            ])),
          if (_saving) const Padding(padding: EdgeInsets.only(top: 12), child: LinearProgressIndicator(minHeight: 2)),
        ],
      ),
    );
  }

  String _greeting(DateTime now) {
    if (now.hour < 5) return 'Bonne nuit';
    if (now.hour < 12) return 'Bonjour';
    if (now.hour < 18) return 'Bon après-midi';
    return 'Bonsoir';
  }

  String _formatHours(double value) {
    final totalMinutes = (value * 60).round();
    return '${totalMinutes ~/ 60}h${(totalMinutes % 60).toString().padLeft(2, '0')}';
  }
}

class _QuickButton extends StatelessWidget {
  const _QuickButton({required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => FilledButton.tonalIcon(onPressed: onTap, icon: Icon(icon, size: 17), label: Text('+ $label'), style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 9), textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)));
}

class _ProgressMetric extends StatelessWidget {
  const _ProgressMetric({required this.label, required this.value, required this.progress});
  final String label;
  final String value;
  final double progress;

  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.only(bottom: 9), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text(label, style: Theme.of(context).textTheme.bodySmall), Text(value, style: Theme.of(context).textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w700))]), const SizedBox(height: 4), ClipRRect(borderRadius: BorderRadius.circular(99), child: LinearProgressIndicator(value: progress, minHeight: 5, backgroundColor: Theme.of(context).colorScheme.surfaceContainerHighest))]));
}

class _MetricGrid extends StatelessWidget {
  const _MetricGrid({required this.snapshot, required this.onSleep, required this.onWater, required this.onNutrition, required this.onWeight, required this.onRoutine, required this.onFocus});
  final DashboardSnapshot snapshot;
  final VoidCallback onSleep;
  final VoidCallback onWater;
  final VoidCallback onNutrition;
  final VoidCallback onWeight;
  final VoidCallback onRoutine;
  final VoidCallback onFocus;

  @override
  Widget build(BuildContext context) {
    final cards = [
      _DashboardMetric(icon: Icons.bedtime_outlined, label: 'Sommeil', value: snapshot.sleep == 0 ? '—' : '${(snapshot.sleep * 60).round() ~/ 60}h${((snapshot.sleep * 60).round() % 60).toString().padLeft(2, '0')}', onTap: onSleep),
      _DashboardMetric(icon: Icons.water_drop_outlined, label: 'Eau', value: snapshot.waterMl == 0 ? '—' : '${(snapshot.waterMl / 1000).toStringAsFixed(1)} L', onTap: onWater),
      _DashboardMetric(icon: Icons.local_fire_department_outlined, label: 'Calories', value: snapshot.kcal == 0 ? '—' : '${snapshot.kcal.toStringAsFixed(0)} kcal', onTap: onNutrition),
      _DashboardMetric(icon: Icons.check_circle_outline, label: 'Habitudes', value: '${snapshot.routineDone}/${snapshot.routineTotal}', onTap: onRoutine),
      _DashboardMetric(icon: Icons.monitor_weight_outlined, label: 'Poids', value: snapshot.weight == null ? '—' : '${snapshot.weight!.toStringAsFixed(1)} kg', onTap: onWeight),
      _DashboardMetric(icon: Icons.work_outline, label: 'Focus', value: snapshot.focusMinutes == 0 ? '—' : '${snapshot.focusMinutes.toStringAsFixed(0)} min', onTap: onFocus),
    ];
    return GridView.builder(shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), itemCount: cards.length, gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(maxCrossAxisExtent: 240, mainAxisExtent: 88, crossAxisSpacing: 10, mainAxisSpacing: 10), itemBuilder: (context, index) => cards[index]);
  }
}

class _DashboardMetric extends StatelessWidget {
  const _DashboardMetric({required this.icon, required this.label, required this.value, required this.onTap});
  final IconData icon;
  final String label;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => InkWell(onTap: onTap, borderRadius: BorderRadius.circular(20), child: PaceGlassCard(child: Row(children: [Icon(icon, size: 19, color: Theme.of(context).colorScheme.primary), const SizedBox(width: 10), Expanded(child: Text(label, style: Theme.of(context).textTheme.bodyMedium)), Text(value, style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700))])));
}

class _FinanceValue extends StatelessWidget {
  const _FinanceValue({required this.label, required this.value, required this.icon, required this.positive});
  final String label;
  final double value;
  final IconData icon;
  final bool positive;

  @override
  Widget build(BuildContext context) => Row(children: [Icon(icon, size: 18, color: positive ? Colors.green : Theme.of(context).colorScheme.error), const SizedBox(width: 8), Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(label, style: Theme.of(context).textTheme.bodySmall), Text('${positive ? '+' : '-'}${value.toStringAsFixed(0)} €', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700))])]);
}
