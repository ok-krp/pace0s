import 'package:flutter/material.dart';

import '../../ui/pace_theme.dart';

class SettingsPage extends StatelessWidget {
  const SettingsPage({super.key});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text('Paramètres', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        const Text('Configuration native Pace.'),
        const SizedBox(height: 20),
        const PaceGlassCard(child: ListTile(contentPadding: EdgeInsets.zero, leading: Icon(Icons.cloud_outlined), title: Text('Synchronisation'), subtitle: Text('La synchronisation Cloud sera ajoutée au service de données commun.'))),
        const SizedBox(height: 12),
        const PaceGlassCard(child: ListTile(contentPadding: EdgeInsets.zero, leading: Icon(Icons.health_and_safety_outlined), title: Text('Santé'), subtitle: Text('Les adaptateurs natifs seront utilisés selon la plateforme.'))),
      ],
    );
  }
}
