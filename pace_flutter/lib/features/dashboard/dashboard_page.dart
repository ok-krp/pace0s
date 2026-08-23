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
    final focus = numberDayMap(widget.localStore.read('pace.work.minutes'));
    final kcal = <String, double>{};
    final protein = <String, double>{};
    final carbs = <String, double>{};
    final fat = <String, double>{};
    final nutrition = widget.localStore.read('pace.nutrition.totals');
    if (nutrition is Map) {
      for (final entry in nutrition.entries) {
        final value = entry.value;
        if (value is Map) {
          kcal[entry.key.toString()] = value['kcal'] is num ? (value['kcal'] as num).toDouble() : 0;
          protein[entry.key.toString()] = value['p'] is num ? (value['p'] as num).toDouble() : 0;
          carbs[entry.key.toString()] = value['c'] is num ? (value['c'] as num).toDouble() : 0;
          fat[entry.key.toString()] = value['f'] is num ? (value['f'] as num).toDouble() : 0;
        }
      }
    }

    final routineDone = integerListLengthMap(widget.localStore.read('pace.routine.done'));
    final routineList = widget.localStore.read('pace.routine.list');
    final routineTotal = routineList is List ? routineList.length : 0;
    final weight = <String, double>{};
    final weightRaw = widget.localStore.read('pace.weight');
    if (weightRaw is Map) {
      for (final entry in weightRaw.entries) {
        final value = entry.value;
        if (value is Map && value['w'] is num) {
          weight[entry.key.toString()] = (value['w'] as num).toDouble();
        } else if (value is num) {
          weight[entry.key.toString()] = value.toDouble();
        }
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
        routineDone: routineDone[today] ?? 0,
        routineTotal: routineTotal,
        focusMinutes: focus[today] ?? 0,
        weight: weight[today],
        income: income,
        spend: spend,
        goals: DashboardGoals.fromDynamic(widget.localStore.read('pace.user.goals')),
        sleepByDay: {for (final day in days) day: sleep[day] ?? 0},
        waterByDay: {for (final day in days) day: water[day] ?? 0},
        kcalByDay: {for (final day in days) day: kcal[day] ?? 0},
        focusByDay: {for (final day in days) day: focus[day] ?? 0},
        routineDoneByDay: {for (final day in days) day: routineDone[day] ?? 0},
        weightByDay: weight,
      );
    });
  }

  Future<void> _writeNumber(String key, String field, double min, double max) async {
    final controller = TextEditingController();
    final value = await showDialog<double>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(field),
        content: TextField(
          controller: controller,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(labelText: field),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Annuler')),
          FilledButton(
            onPressed: () {
              final parsed = double.tryParse(controller.text.replaceAll(',', '.'));
              if (parsed != null && parsed >= min && parsed <= max) Navigator.pop(context, parsed);
            },
            child: const Text('Enregistrer'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (value == null || _snapshot == null) return;

    final raw = widget.localStore.read(key);
    final data = Map<String, dynamic>.from(raw is Map ? raw : <String, dynamic>{});
    if (key == 'pace.sleep') {
      data[_snapshot!.today] = {'hours': value};
    } else if (key == 'pace.weight') {
      data[_snapshot!.today] = {'w': value};
    } else {
      data[_snapshot!.today] = value;
    }
    await widget.localStore.write(key, data);
    await _load();
  }

  Future<void> _addWater() async {
    final current = numberDayMap(widget.localStore.read('pace.water'));
    final logsRaw = widget.localStore.read('pace.water.log');
    final logs = logsRaw is Map ? Map<String, dynamic>.from(logsRaw) : <String, dynamic>{};
    final day = _snapshot?.today;
    if (day == null) return;
    current[day] = (current[day] ?? 0) + 250;
    final dayLogs = logs[day] is List ? List<dynamic>.from(logs[day] as List) : <dynamic>[];
    dayLogs.add(DateTime.now().millisecondsSinceEpoch);
    logs[day] = dayLogs;
    await widget.localStore.write('pace.water', current);
    await widget.localStore.write('pace.water.log', logs);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final snapshot = _snapshot;
    if (snapshot == null) return const Center(child: CircularProgressIndicator());

    final days = lastSevenDays(DateTime.now());
    final score = snapshot.scoreFor(snapshot.today);
    final average = (days.map(snapshot.scoreFor).fold<int>(0, (a, b) => a + b) / days.length).round();
    final routineRatio = snapshot.routineTotal <= 0
        ? 0.0
        : (snapshot.routineDone / snapshot.routineTotal).clamp(0.0, 1.0).toDouble();

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(20),
        children: [
          Text(_greeting(DateTime.now()), style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text(frenchDateLabel(DateTime.now()), style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
          const SizedBox(height: 18),
          Wrap(spacing: 8, runSpacing: 8, children: [
            _Action(icon: Icons.water_drop_outlined, label: 'Eau', onTap: _addWater),
            _Action(icon: Icons.bedtime_outlined, label: 'Sommeil', onTap: () => _writeNumber('pace.sleep', 'Sommeil (heures)', 0, 24)),
            _Action(icon: Icons.monitor_weight_outlined, label: 'Poids', onTap: () => _writeNumber('pace.weight', 'Poids (kg)', 1, 500)),
            _Action(icon: Icons.timer_outlined, label: 'Focus', onTap: () => _writeNumber('pace.work.minutes', 'Focus (minutes)', 0, 1440)),
          ]),
          const SizedBox(height: 14),
          PaceGlassCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Aujourd’hui', style: Theme.of(context).textTheme.labelSmall?.copyWith(letterSpacing: 1.8, fontWeight: FontWeight.w600)),
              const SizedBox(height: 4),
              Text('Ton rythme quotidien', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              Text('${score - average >= 0 ? '↑' : '↓'} ${(score - average).abs()} pts vs moyenne 7 j'),
              const SizedBox(height: 18),
              Row(children: [
                SizedBox(width: 120, height: 120, child: Stack(alignment: Alignment.center, children: [
                  SizedBox(width: 120, height: 120, child: CircularProgressIndicator(value: score / 100, strokeWidth: 10)),
                  Column(mainAxisSize: MainAxisSize.min, children: [Text('$score', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w800)), const Text('/ 100')]),
                ])),
                const SizedBox(width: 18),
                Expanded(child: Column(children: [
                  _Metric('Sommeil', _formatHours(snapshot.sleep), snapshot.sleep / 8),
                  _Metric('Hydratation', '${(snapshot.waterMl / 1000).toStringAsFixed(1)} L', snapshot.waterMl / snapshot.goals.waterMl),
                  _Metric('Nutrition', '${snapshot.kcal.toStringAsFixed(0)} kcal', snapshot.kcal / snapshot.goals.kcal),
                  _Metric('Routine', '${snapshot.routineDone}/${snapshot.routineTotal}', routineRatio),
                  _Metric('Focus', '${snapshot.focusMinutes.toStringAsFixed(0)} min', snapshot.focusMinutes / 240),
                ])),
              ]),
            ]),
          ),
          const SizedBox(height: 12),
          PaceGlassCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Résumé', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: 12),
              _Row('Calories', '${snapshot.kcal.toStringAsFixed(0)} kcal'),
              _Row('Protéines', '${snapshot.protein.toStringAsFixed(0)} g'),
              _Row('Glucides', '${snapshot.carbs.toStringAsFixed(0)} g'),
              _Row('Lipides', '${snapshot.fat.toStringAsFixed(0)} g'),
              _Row('Poids', snapshot.weight == null ? '—' : '${snapshot.weight!.toStringAsFixed(1)} kg'),
              _Row('Finances', '+${snapshot.income.toStringAsFixed(2)} € / -${snapshot.spend.toStringAsFixed(2)} €'),
            ]),
          ),
        ],
      ),
    );
  }

  String _greeting(DateTime now) {
    if (now.hour < 12) return 'Bonjour';
    if (now.hour < 18) return 'Bon après-midi';
    return 'Bonsoir';
  }

  String _formatHours(double value) {
    final totalMinutes = (value * 60).round();
    return '${totalMinutes ~/ 60}h${(totalMinutes % 60).toString().padLeft(2, '0')}';
  }
}

class _Action extends StatelessWidget {
  const _Action({required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => ActionChip(avatar: Icon(icon, size: 18), label: Text(label), onPressed: onTap);
}

class _Metric extends StatelessWidget {
  const _Metric(this.label, this.value, this.progress);
  final String label;
  final String value;
  final double progress;

  @override
  Widget build(BuildContext context) {
    final safe = progress.clamp(0.0, 1.0).toDouble();
    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text(label), Text(value, style: const TextStyle(fontWeight: FontWeight.w600))]),
        const SizedBox(height: 4),
        LinearProgressIndicator(value: safe, minHeight: 5, borderRadius: BorderRadius.circular(8)),
      ]),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text(label), Text(value, style: const TextStyle(fontWeight: FontWeight.w600))]),
      );
}
