import 'package:flutter/material.dart';

import '../../core/storage/local_store.dart';
import '../../core/supabase/pace_supabase.dart';
import '../../core/sync/sync_service.dart';
import '../ai/ai_page.dart';
import '../calendar/calendar_page.dart';
import '../notes/notes_page.dart';
import '../routine/routine_page.dart';
import '../shopping/shopping_page.dart';

class MorePage extends StatelessWidget {
  const MorePage({
    super.key,
    required this.localStore,
    required this.auth,
    required this.sync,
    required this.themeMode,
    required this.onThemeChanged,
  });
  final LocalStore localStore;
  final PaceAuthService auth;
  final SyncService sync;
  final ThemeMode themeMode;
  final ValueChanged<ThemeMode> onThemeChanged;

  @override
  Widget build(BuildContext context) {
    final entries = <_Entry>[
      _Entry('Habitudes', Icons.check_circle_outline, () => Navigator.push(context, MaterialPageRoute(builder: (_) => RoutinePage(localStore: localStore)))),
      _Entry('Calendrier', Icons.calendar_month_outlined, () => Navigator.push(context, MaterialPageRoute(builder: (_) => CalendarPage(localStore: localStore)))),
      _Entry('Notes', Icons.note_alt_outlined, () => Navigator.push(context, MaterialPageRoute(builder: (_) => NotesPage(localStore: localStore)))),
      _Entry('Courses', Icons.shopping_cart_outlined, () => Navigator.push(context, MaterialPageRoute(builder: (_) => ShoppingPage(localStore: localStore)))),
      _Entry('Watch & Santé', Icons.watch_outlined, () => _showNativeStatus(context, 'Les adaptateurs natifs restent spécifiques à chaque plateforme et ne produisent aucune donnée simulée.')),
      _Entry('IA', Icons.auto_awesome_outlined, () => Navigator.push(context, MaterialPageRoute(builder: (_) => AiPage(localStore: localStore, auth: auth, sync: sync)))),
      _Entry('Paramètres', Icons.settings_outlined, () => _showSettings(context)),
    ];
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text('Pace', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        const Text('Fonctionnalités natives Pace'),
        const SizedBox(height: 18),
        for (final entry in entries)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Card(
              child: ListTile(
                leading: Icon(entry.icon),
                title: Text(entry.title),
                trailing: const Icon(Icons.chevron_right),
                onTap: entry.onTap,
              ),
            ),
          ),
      ],
    );
  }

  void _showNativeStatus(BuildContext context, String text) => showDialog<void>(
        context: context,
        builder: (_) => AlertDialog(
          title: const Text('Pace natif'),
          content: Text(text),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: const Text('Fermer')),
          ],
        ),
      );

  void _showSettings(BuildContext context) => Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => SettingsPageBridge(
            auth: auth,
            localStore: localStore,
            themeMode: themeMode,
            onThemeChanged: onThemeChanged,
          ),
        ),
      );
}

class SettingsPageBridge extends StatefulWidget {
  const SettingsPageBridge({
    super.key,
    required this.auth,
    required this.localStore,
    required this.themeMode,
    required this.onThemeChanged,
  });
  final PaceAuthService auth;
  final LocalStore localStore;
  final ThemeMode themeMode;
  final ValueChanged<ThemeMode> onThemeChanged;

  @override
  State<SettingsPageBridge> createState() => _SettingsPageBridgeState();
}

class _SettingsPageBridgeState extends State<SettingsPageBridge> {
  late bool _aiConfirmations;
  late bool _notifications;
  late bool _memory;

  @override
  void initState() {
    super.initState();
    _aiConfirmations = widget.localStore.read('pace.settings.ai.confirm_actions') as bool? ?? true;
    _notifications = widget.localStore.read('pace.settings.notifications') as bool? ?? true;
    _memory = widget.localStore.read('pace.settings.ai.memory') as bool? ?? true;
  }

  Future<void> _setBool(String key, bool value, void Function() update) async {
    update();
    await widget.localStore.write(key, value);
  }

  String _themeLabel(ThemeMode mode) {
    switch (mode) {
      case ThemeMode.light:
        return 'Clair';
      case ThemeMode.dark:
        return 'Sombre';
      case ThemeMode.system:
        return 'Système';
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Paramètres')),
        body: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            _section('Compte', [
              ListTile(
                title: Text(widget.auth.currentUser?.email ?? 'Compte local'),
                trailing: TextButton(
                  onPressed: widget.auth.currentUser == null ? null : () => widget.auth.signOut(),
                  child: const Text('Déconnexion'),
                ),
              ),
            ]),
            _section('Apparence', [
              ListTile(
                title: const Text('Thème'),
                subtitle: Text(_themeLabel(widget.themeMode)),
                trailing: DropdownButton<ThemeMode>(
                  value: widget.themeMode,
                  onChanged: (mode) {
                    if (mode != null) widget.onThemeChanged(mode);
                  },
                  items: const [
                    DropdownMenuItem(value: ThemeMode.system, child: Text('Système')),
                    DropdownMenuItem(value: ThemeMode.light, child: Text('Clair')),
                    DropdownMenuItem(value: ThemeMode.dark, child: Text('Sombre')),
                  ],
                ),
              ),
            ]),
            _section('IA', [
              SwitchListTile.adaptive(
                title: const Text('Confirmation des actions IA'),
                subtitle: const Text('Demander une confirmation avant une action importante ou destructive.'),
                value: _aiConfirmations,
                onChanged: (value) => _setBool('pace.settings.ai.confirm_actions', value, () => setState(() => _aiConfirmations = value)),
              ),
              SwitchListTile.adaptive(
                title: const Text('Mémoire IA'),
                subtitle: const Text('Autoriser la mémoire persistante contrôlable par l’utilisateur.'),
                value: _memory,
                onChanged: (value) => _setBool('pace.settings.ai.memory', value, () => setState(() => _memory = value)),
              ),
            ]),
            _section('Notifications', [
              SwitchListTile.adaptive(
                title: const Text('Notifications Pace'),
                value: _notifications,
                onChanged: (value) => _setBool('pace.settings.notifications', value, () => setState(() => _notifications = value)),
              ),
            ]),
            _section('Données & synchronisation', [
              ListTile(
                title: const Text('Stockage local'),
                subtitle: Text('${widget.localStore.pendingOperations().length} opération(s) en attente de synchronisation'),
              ),
            ]),
          ],
        ),
      );

  Widget _section(String title, List<Widget> children) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Card(
          child: ExpansionTile(
            title: Text(title),
            initiallyExpanded: false,
            children: children,
          ),
        ),
      );
}

class _Entry {
  const _Entry(this.title, this.icon, this.onTap);
  final String title;
  final IconData icon;
  final VoidCallback onTap;
}
