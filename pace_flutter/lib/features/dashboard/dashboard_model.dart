class DashboardGoals {
  const DashboardGoals({required this.kcal, required this.waterMl, this.weightGoalKg});

  final double kcal;
  final double waterMl;
  final double? weightGoalKg;

  factory DashboardGoals.fromDynamic(dynamic value) {
    if (value is Map) {
      double number(dynamic v, double fallback) => v is num ? v.toDouble() : fallback;
      return DashboardGoals(
        kcal: number(value['kcal'], 2300),
        waterMl: number(value['waterMl'], 2500),
        weightGoalKg: value['weightGoalKg'] is num ? (value['weightGoalKg'] as num).toDouble() : null,
      );
    }
    return const DashboardGoals(kcal: 2300, waterMl: 2500);
  }
}

class DashboardSnapshot {
  const DashboardSnapshot({
    required this.today,
    required this.sleep,
    required this.waterMl,
    required this.kcal,
    required this.protein,
    required this.carbs,
    required this.fat,
    required this.routineDone,
    required this.routineTotal,
    required this.focusMinutes,
    required this.weight,
    required this.income,
    required this.spend,
    required this.goals,
    required this.sleepByDay,
    required this.waterByDay,
    required this.kcalByDay,
    required this.focusByDay,
    required this.routineDoneByDay,
    required this.weightByDay,
  });

  final String today;
  final double sleep;
  final double waterMl;
  final double kcal;
  final double protein;
  final double carbs;
  final double fat;
  final int routineDone;
  final int routineTotal;
  final double focusMinutes;
  final double? weight;
  final double income;
  final double spend;
  final DashboardGoals goals;
  final Map<String, double> sleepByDay;
  final Map<String, double> waterByDay;
  final Map<String, double> kcalByDay;
  final Map<String, double> focusByDay;
  final Map<String, int> routineDoneByDay;
  final Map<String, double> weightByDay;

  double _ratio(double value, double target) => target <= 0 ? 0 : (value / target).clamp(0, 1).toDouble();

  int scoreFor(String day) {
    final routineTotalSafe = routineTotal == 0 ? 1 : routineTotal;
    return (_ratio(sleepByDay[day] ?? 0, 8) * 20 +
            _ratio(waterByDay[day] ?? 0, goals.waterMl) * 15 +
            _ratio(kcalByDay[day] ?? 0, goals.kcal) * 15 +
            ((routineDoneByDay[day] ?? 0) / routineTotalSafe) * 30 +
            _ratio(focusByDay[day] ?? 0, 240) * 20)
        .round();
  }
}

String dateKey(DateTime date) {
  final y = date.year.toString().padLeft(4, '0');
  final m = date.month.toString().padLeft(2, '0');
  final d = date.day.toString().padLeft(2, '0');
  return '$y-$m-$d';
}

List<String> lastSevenDays([DateTime? from]) {
  final today = from ?? DateTime.now();
  return List.generate(7, (index) => dateKey(DateTime(today.year, today.month, today.day - (6 - index))));
}

String frenchDateLabel(DateTime date) {
  const weekdays = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  return '${weekdays[date.weekday - 1]} ${date.day} ${months[date.month - 1]}';
}

Map<String, double> numberDayMap(dynamic value) {
  if (value is! Map) return <String, double>{};
  return value.map<String, double>((key, item) => MapEntry(key.toString(), item is num ? item.toDouble() : 0));
}

Map<String, int> integerListLengthMap(dynamic value) {
  if (value is! Map) return <String, int>{};
  return value.map<String, int>((key, item) => MapEntry(key.toString(), item is List ? item.length : item is num ? item.toInt() : 0));
}
