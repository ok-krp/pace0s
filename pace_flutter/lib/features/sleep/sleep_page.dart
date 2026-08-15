import 'package:flutter/material.dart';

import '../../ui/pace_theme.dart';

class SleepPage extends StatelessWidget {
  const SleepPage({super.key});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text('Sommeil', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 20),
        const PaceGlassCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Heures de sommeil'),
            SizedBox(height: 12),
            Text('Aucune donnée locale'),
          ]),
        ),
      ],
    );
  }
}
