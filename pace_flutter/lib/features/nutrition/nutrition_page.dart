import 'package:flutter/material.dart';

import '../../ui/pace_theme.dart';

class NutritionPage extends StatelessWidget {
  const NutritionPage({super.key});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text('Nutrition', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        const Text('Données locales prêtes à être reliées au domaine Nutrition.'),
        const SizedBox(height: 20),
        const PaceGlassCard(child: ListTile(contentPadding: EdgeInsets.zero, leading: Icon(Icons.local_fire_department_outlined), title: Text('Calories'), trailing: Text('— kcal'))),
        const SizedBox(height: 12),
        const PaceGlassCard(child: ListTile(contentPadding: EdgeInsets.zero, leading: Icon(Icons.fitness_center_outlined), title: Text('Protéines'), trailing: Text('— g'))),
      ],
    );
  }
}
