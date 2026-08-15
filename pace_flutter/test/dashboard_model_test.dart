import 'package:flutter_test/flutter_test.dart';

import 'package:pace/features/dashboard/dashboard_model.dart';

void main() {
  test('date keys and seven-day window are stable', () {
    final date = DateTime(2026, 8, 15);
    expect(dateKey(date), '2026-08-15');
    expect(lastSevenDays(date), [
      '2026-08-09',
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
    ]);
  });

  test('dashboard score follows the web weighting', () {
    const goals = DashboardGoals(kcal: 2300, waterMl: 2500);
    final snapshot = DashboardSnapshot(
      today: '2026-08-15',
      sleep: 8,
      waterMl: 2500,
      kcal: 2300,
      protein: 140,
      carbs: 250,
      fat: 70,
      routineDone: 2,
      routineTotal: 2,
      focusMinutes: 240,
      weight: 65,
      income: 0,
      spend: 0,
      goals: goals,
      sleepByDay: const {'2026-08-15': 8},
      waterByDay: const {'2026-08-15': 2500},
      kcalByDay: const {'2026-08-15': 2300},
      focusByDay: const {'2026-08-15': 240},
      routineDoneByDay: const {'2026-08-15': 2},
      weightByDay: const {'2026-08-15': 65},
    );

    expect(snapshot.scoreFor('2026-08-15'), 100);
  });

  test('goals fall back only when no compatible local goals exist', () {
    expect(DashboardGoals.fromDynamic({'kcal': 2800, 'waterMl': 3000}).kcal, 2800);
    expect(DashboardGoals.fromDynamic({'kcal': 2800, 'waterMl': 3000}).waterMl, 3000);
    expect(DashboardGoals.fromDynamic(null).kcal, 2300);
  });
}
