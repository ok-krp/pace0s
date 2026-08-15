import 'package:flutter/material.dart';

import '../../core/storage/local_store.dart';
import '../../core/supabase/pace_supabase.dart';
import '../calendar/calendar_page.dart';
import '../notes/notes_page.dart';
import '../routine/routine_page.dart';

class MorePage extends StatelessWidget {
  const MorePage({super.key, required this.localStore, required this.auth});
  final LocalStore localStore;
  final PaceAuthService auth;

  @override
  Widget build(BuildContext context) {
    final entries = <_Entry>[
      _Entry('Habitudes', Icons.check_circle_outline, () => Navigator.push(context, MaterialPageRoute(builder: (_) => RoutinePage(localStore: localStore)))),
      _Entry('Calendrier', Icons.calendar_month_outlined, () => Navigator.push(context, MaterialPageRoute(builder: (_) => CalendarPage(localStore: localStore)))),
      _Entry('Notes', Icons.note_alt_outlined, () => Navigator.push(context, MaterialPageRoute(builder: (_) => NotesPage(localStore: localStore)))),
      _Entry('Watch & Santé', Icons.watch_outlined, () => _showNativeStatus(context, 'Les adaptateurs natifs sont conservés séparément pour chaque plateforme.')),
      _Entry('IA', Icons.auto_awesome_outlined, () => _showNativeStatus(context, 'Le service IA utilisera les données locales et Supabase, sans WebView.')),
      _Entry('Paramètres', Icons.settings_outlined, () => _showSettings(context)),
    ];
    return ListView(padding: const EdgeInsets.all(20), children: [
      Text('Pace', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700)),
      const SizedBox(height: 6),
      const Text('Fonctionnalités natives Pace'),
      const SizedBox(height: 18),
      for (final entry in entries)
        Padding(padding: const EdgeInsets.only(bottom: 8), child: Card(child: ListTile(leading: Icon(entry.icon), title: Text(entry.title), trailing: const Icon(Icons.chevron_right), onTap: entry.onTap))),
    ]);
  }

  void _showNativeStatus(BuildContext context, String text) => showDialog<void>(context: context, builder: (_) => AlertDialog(title: const Text('Pace natif'), content: Text(text), actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Fermer'))]));

  void _showSettings(BuildContext context) => Navigator.push(context, MaterialPageRoute(builder: (_) => SettingsPageBridge(auth: auth)));
}

class SettingsPageBridge extends StatelessWidget {
  const SettingsPageBridge({super.key, required this.auth});
  final PaceAuthService auth;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Paramètres')),
        body: ListView(padding: const EdgeInsets.all(20), children: [
          ListTile(
            title: Text(auth.currentUser?.email ?? 'Compte local'),
            trailing: TextButton(
              onPressed: auth.currentUser == null ? null : () => auth.signOut(),
              child: const Text('Déconnexion'),
            ),
          ),
        ]),
      );
}

class _Entry {
  const _Entry(this.title, this.icon, this.onTap);
  final String title;
  final IconData icon;
  final VoidCallback onTap;
}
