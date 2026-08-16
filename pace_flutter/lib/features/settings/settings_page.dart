import 'package:flutter/material.dart';

import '../../core/supabase/pace_supabase.dart';
import '../../ui/pace_theme.dart';

class SettingsPage extends StatelessWidget {
  const SettingsPage({super.key, required this.auth});

  final PaceAuthService auth;

  @override
  Widget build(BuildContext context) {
    final user = auth.currentUser;
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text('Paramètres', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        Text(user == null ? 'Mode hors connexion' : user.email ?? 'Compte Pace'),
        const SizedBox(height: 20),
        PaceGlassCard(
          child: ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.cloud_outlined),
            title: const Text('Synchronisation'),
            subtitle: Text(user == null ? 'Les données locales restent disponibles hors connexion.' : 'Les modifications sont synchronisées avec Pace Cloud.'),
          ),
        ),
        const SizedBox(height: 12),
        const PaceGlassCard(
          child: ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Icon(Icons.health_and_safety_outlined),
            title: Text('Santé'),
            subtitle: Text('Les adaptateurs natifs seront utilisés selon la plateforme.'),
          ),
        ),
        if (user != null) ...[
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: () => auth.signOut(),
            icon: const Icon(Icons.logout),
            label: const Text('Se déconnecter'),
          ),
        ],
      ],
    );
  }
}
