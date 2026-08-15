import 'package:flutter/material.dart';

import '../../core/storage/local_store.dart';
import '../../ui/pace_theme.dart';

class DashboardPage extends StatelessWidget {
  const DashboardPage({super.key, required this.localStore});

  final LocalStore localStore;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
      children: [
        Text('Aujourd’hui', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        Text('Votre rythme Pace', style: Theme.of(context).textTheme.bodyMedium),
        const SizedBox(height: 20),
        const PaceGlassCard(child: _MetricRow(label: 'Sommeil', value: '—')),
        const SizedBox(height: 12),
        const PaceGlassCard(child: _MetricRow(label: 'Eau', value: '—')),
        const SizedBox(height: 12),
        const PaceGlassCard(child: _MetricRow(label: 'Calories', value: '—')),
        const SizedBox(height: 12),
        const PaceGlassCard(child: _MetricRow(label: 'Habitudes', value: '0/0')),
        const SizedBox(height: 20),
        Text('Mode hors connexion actif', style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }
}

class _MetricRow extends StatelessWidget {
  const _MetricRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Row(
        children: [
          Expanded(child: Text(label, style: Theme.of(context).textTheme.titleMedium)),
          Text(value, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
        ],
      );
}
