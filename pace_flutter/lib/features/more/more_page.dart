import 'dart:io';
import 'dart:math';

import 'package:image_picker/image_picker.dart';
import 'package:material_ui/material_ui.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../../core/compliance/compliance_service.dart';
import '../../core/notifications/notification_service.dart';
import '../../core/storage/local_store.dart';
import '../../core/supabase/pace_supabase.dart';
import '../../core/sync/sync_service.dart';
import '../ai/ai_page.dart';
import '../ai/ai_service.dart';
import '../calendar/calendar_page.dart';
import '../health/health_page.dart';
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
    required this.visualTheme,
    required this.onThemeChanged,
    required this.onVisualThemeChanged,
  });
  final LocalStore localStore;
  final PaceAuthService auth;
  final SyncService sync;
  final ThemeMode themeMode;
  final String visualTheme;
  final ValueChanged<ThemeMode> onThemeChanged;
  final ValueChanged<String> onVisualThemeChanged;

  @override
  Widget build(BuildContext context) {
    final entries = <_Entry>[
      _Entry('Habitudes', Icons.check_circle_outline, () => Navigator.push(context, MaterialPageRoute(builder: (_) => RoutinePage(localStore: localStore)))),
      _Entry('Calendrier', Icons.calendar_month_outlined, () => Navigator.push(context, MaterialPageRoute(builder: (_) => CalendarPage(localStore: localStore)))),
      _Entry('Notes', Icons.note_alt_outlined, () => Navigator.push(context, MaterialPageRoute(builder: (_) => NotesPage(localStore: localStore)))),
      _Entry('Courses', Icons.shopping_cart_outlined, () => Navigator.push(context, MaterialPageRoute(builder: (_) => ShoppingPage(localStore: localStore)))),
      _Entry('Santé', Icons.health_and_safety_outlined, () => Navigator.push(context, MaterialPageRoute(builder: (_) => HealthPage(localStore: localStore, sync: sync)))),
      _Entry('Watch & Bluetooth', Icons.watch_outlined, () => _showNativeStatus(context, 'La couche Bluetooth Flutter utilise un adaptateur natif. Les données ne sont affichées que lorsqu’une plateforme fournit réellement une mesure.')),
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
            sync: sync,
            localStore: localStore,
            themeMode: themeMode,
            visualTheme: visualTheme,
            onThemeChanged: onThemeChanged,
            onVisualThemeChanged: onVisualThemeChanged,
          ),
        ),
      );
}

class SettingsPageBridge extends StatefulWidget {
  const SettingsPageBridge({
    super.key,
    required this.auth,
    required this.sync,
    required this.localStore,
    required this.themeMode,
    required this.visualTheme,
    required this.onThemeChanged,
    required this.onVisualThemeChanged,
  });
  final PaceAuthService auth;
  final SyncService sync;
  final LocalStore localStore;
  final ThemeMode themeMode;
  final String visualTheme;
  final ValueChanged<ThemeMode> onThemeChanged;
  final ValueChanged<String> onVisualThemeChanged;

  @override
  State<SettingsPageBridge> createState() => _SettingsPageBridgeState();
}

class _SettingsPageBridgeState extends State<SettingsPageBridge> {
  late final PaceAiService _ai = PaceAiService(localStore: widget.localStore, sync: widget.sync, auth: widget.auth);
  late bool _aiConfirmations;
  late bool _notifications;
  late bool _memory;
  bool _syncCloudConsent = false;
  bool _healthConsent = false;
  bool _healthCloudConsent = false;
  bool _financialConsent = false;
  bool _aiConsent = false;
  bool _marketingConsent = false;
  bool _deleting = false;

  @override
  void initState() {
    super.initState();
    _aiConfirmations = _ai.confirmActions;
    _notifications = widget.localStore.read('pace.settings.notifications') as bool? ?? true;
    _memory = _ai.memoryEnabled;
    _loadConsent();
  }

  Future<void> _loadConsent() async {
    final client = widget.auth.client;
    final user = client?.auth.currentUser;
    if (client == null || user == null ||
        widget.localStore.currentAccountId != user.id) {
      return;
    }
    final userId = user.id;
    try {
      final rows = await client
          .from('consent_records')
          .select('consent_type,granted,created_at')
          .eq('user_id', user.id)
          .order('created_at', ascending: false);
      if (!mounted ||
          widget.auth.currentUser?.id != userId ||
          widget.localStore.currentAccountId != userId) {
        return;
      }
      // Functional cross-device sync is stored alongside the accepted
      // privacy/EULA options in legal_consent.opts, not in consent_records.
      final syncCloudConsent =
          await PaceComplianceService(client).hasConsent('sync_cloud');
      if (!mounted ||
          widget.auth.currentUser?.id != userId ||
          widget.localStore.currentAccountId != userId) {
        return;
      }

      final latest = <String, bool>{};
      for (final row in rows) {
        final type = row['consent_type'] as String?;
        if (type != null && !latest.containsKey(type)) {
          latest[type] = row['granted'] == true;
        }
      }
      if (!mounted) return;
      setState(() {
        _syncCloudConsent = syncCloudConsent;
        _healthConsent = latest['health_data'] ?? false;
        _healthCloudConsent = latest['health_cloud_sync'] ?? false;
        _financialConsent = latest['financial_data'] ?? false;
        _aiConsent = latest['ai_processing'] ?? false;
        _marketingConsent = latest['marketing'] ?? false;
      });
      await widget.sync.setCloudSyncConsent(_syncCloudConsent);
      if (_syncCloudConsent) await widget.sync.syncNow();
    } catch (_) {}
  }

  Future<void> _setConsent(String type, bool value) async {
    final userId = widget.auth.currentUser?.id;
    if (userId == null || widget.localStore.currentAccountId != userId) return;
    final service = PaceComplianceService(widget.auth.client);
    try {
      await service.recordConsent(
        consentType: type,
        granted: value,
        legalVersion: '2026-09-20',
        policyVersion: '2026-09-20',
      );
      if (!mounted ||
          widget.auth.currentUser?.id != userId ||
          widget.localStore.currentAccountId != userId) {
        return;
      }
      setState(() {
        if (type == 'sync_cloud') _syncCloudConsent = value;
        if (type == 'health_data') _healthConsent = value;
        if (type == 'health_cloud_sync') _healthCloudConsent = value;
        if (type == 'financial_data') _financialConsent = value;
        if (type == 'ai_processing') _aiConsent = value;
        if (type == 'marketing') _marketingConsent = value;
      });
      if (type == 'sync_cloud') {
        await widget.sync.setCloudSyncConsent(value);
        if (value) {
          await _migrateLocalWallpaperToCloud();
          await widget.sync.syncNow();
        }
      }
    } catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<void> _requestDeletion() async {
    if (_deleting) return;
    final userId = widget.auth.currentUser?.id;
    if (userId == null || widget.localStore.currentAccountId != userId) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Supprimer le compte ?'),
        content: const Text('La demande sera enregistrée et traitée côté serveur. Cette action concerne le compte et les données Pace associées.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Annuler')),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Demander la suppression')),
        ],
      ),
    );
    if (confirmed != true) return;
    if (!mounted ||
        widget.auth.currentUser?.id != userId ||
        widget.localStore.currentAccountId != userId) {
      return;
    }
    setState(() => _deleting = true);
    try {
      await PaceComplianceService(widget.auth.client).requestAccountDeletion();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Demande de suppression enregistrée.')));
    } catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
    } finally {
      if (mounted) setState(() => _deleting = false);
    }
  }

  Future<void> _setNotification(bool value) async {
    final userId = widget.auth.currentUser?.id;
    if (userId != null && widget.localStore.currentAccountId != userId) return;
    if (value) {
      final granted = await PaceNotificationService.instance.requestPermissions();
      if (!granted) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Autorisation de notifications refusée.')));
        return;
      }
    } else {
      await PaceNotificationService.instance.cancelAll();
    }
    if (!mounted ||
        (userId != null &&
            (widget.auth.currentUser?.id != userId ||
                widget.localStore.currentAccountId != userId))) {
      return;
    }
    setState(() => _notifications = value);
    await widget.localStore.write('pace.settings.notifications', value);
    await widget.sync.syncNow();
  }

  Future<String> _persistWallpaperLocally(File file, String extension) async {
    final supportDirectory = await getApplicationSupportDirectory();
    final wallpaperDirectory = Directory(
      p.join(supportDirectory.path, 'wallpapers'),
    );
    await wallpaperDirectory.create(recursive: true);
    final localFile = await file.copy(p.join(
      wallpaperDirectory.path,
      'pace_wallpaper_${DateTime.now().microsecondsSinceEpoch}$extension',
    ));
    return localFile.path;
  }

  Future<void> _migrateLocalWallpaperToCloud() async {
    final client = widget.auth.client;
    final userId = widget.auth.currentUser?.id;
    if (!_syncCloudConsent || client == null || userId == null ||
        widget.localStore.currentAccountId != userId) {
      return;
    }
    final choice = widget.localStore.read('pace.wallpaper');
    if (choice is! Map || choice['kind'] != 'custom' ||
        choice['localPath'] is! String) {
      return;
    }
    final localPath = choice['localPath'] as String;
    final file = File(localPath);
    if (!await file.exists()) return;
    final extension = p.extension(localPath).toLowerCase();
    final safeExtension = const {'.jpg', '.jpeg', '.png', '.webp'}.contains(extension)
        ? (extension == '.jpeg' ? '.jpg' : extension)
        : '.jpg';
    final objectPath = '$userId/${DateTime.now().microsecondsSinceEpoch}_${Random.secure().nextInt(1 << 32)}$safeExtension';
    await client.storage.from('pace-wallpapers').upload(
      objectPath,
      file,
    );
    await widget.localStore.write('pace.wallpaper', {
      'kind': 'custom',
      'storagePath': objectPath,
    });
  }

  Future<void> _chooseWallpaper() async {
    final picker = ImagePicker();
    final picked = await picker.pickImage(
      source: ImageSource.gallery,
      maxWidth: 2560,
      maxHeight: 2560,
      imageQuality: 90,
    );
    if (picked == null || !mounted) return;
    try {
      final file = File(picked.path);
      if (!await file.exists()) throw StateError("Fichier image introuvable.");
      if (await file.length() > 20 * 1024 * 1024) {
        throw StateError("Image trop lourde (maximum 20 Mo).");
      }
      final extension = p.extension(picked.path).toLowerCase();
      if (!const {'.jpg', '.jpeg', '.png', '.webp'}.contains(extension)) {
        throw StateError("Formats acceptés : JPG, PNG ou WebP.");
      }
      final client = widget.auth.client;
      final userId = widget.auth.currentUser?.id;
      if (_syncCloudConsent && client != null && userId != null &&
          widget.localStore.currentAccountId == userId) {
        final safeExtension = extension == '.jpeg' ? '.jpg' : extension;
        final objectPath = '$userId/${DateTime.now().microsecondsSinceEpoch}_${Random.secure().nextInt(1 << 32)}$safeExtension';
        try {
          await client.storage.from('pace-wallpapers').upload(objectPath, file);
          await widget.localStore.write('pace.wallpaper', {
            'kind': 'custom',
            'storagePath': objectPath,
          });
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text("Fond d'écran synchronisable enregistré.")),
            );
          }
        } catch (uploadError) {
          if (await file.length() > 3 * 1024 * 1024) rethrow;
          final localPath = await _persistWallpaperLocally(file, extension);
          await widget.localStore.write('pace.wallpaper', {
            'kind': 'custom',
            'localPath': localPath,
          });
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text("Stockage synchronisé indisponible : fond enregistré localement. Réessaie après activation du bucket.")),
            );
          }
        }
      } else {
        final localPath = await _persistWallpaperLocally(file, extension);
        await widget.localStore.write('pace.wallpaper', {
          'kind': 'custom',
          'localPath': localPath,
        });
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text("Fond d'écran enregistré sur cet appareil. Active la synchronisation cloud pour le partager.")),
          );
        }
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error.toString())),
        );
      }
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
                subtitle: const Text('Le choix est synchronisé avec les autres appareils du compte.'),
                trailing: DropdownButton<ThemeMode>(
                  value: widget.themeMode,
                  onChanged: (mode) {
                    if (mode != null) widget.onThemeChanged(mode);
                  },
                  items: const [
                    DropdownMenuItem(value: ThemeMode.light, child: Text('Clair')),
                    DropdownMenuItem(value: ThemeMode.dark, child: Text('Sombre')),
                  ],
                ),
              ),
              ListTile(
                title: const Text('Style visuel'),
                subtitle: const Text('Liquid Glass utilise une palette neutre, sans dégradés multicolores.'),
                trailing: DropdownButton<String>(
                  value: widget.visualTheme,
                  onChanged: (theme) {
                    if (theme != null) widget.onVisualThemeChanged(theme);
                  },
                  items: const [
                    DropdownMenuItem(value: 'default', child: Text('Pace')),
                    DropdownMenuItem(value: 'signal', child: Text('Signal')),
                    DropdownMenuItem(value: 'glass', child: Text('Liquid Glass')),
                  ],
                ),
              ),
              ListTile(
                title: const Text("Fond d'écran"),
                subtitle: Text(_syncCloudConsent
                    ? 'Image privée synchronisée entre les appareils de ce compte.'
                    : 'Image locale. Active la synchronisation pour la partager.'),
                trailing: IconButton(
                  tooltip: 'Choisir une image',
                  onPressed: _chooseWallpaper,
                  icon: const Icon(Icons.wallpaper_outlined),
                ),
              ),
              Wrap(
                spacing: 8,
                children: [
                  for (final preset in const [
                    ('graphite', 'Graphite'),
                    ('mist', 'Brume'),
                    ('slate', 'Ardoise'),
                  ])
                    OutlinedButton(
                      onPressed: () => widget.localStore.write(
                        'pace.wallpaper',
                        {'id': preset.$1},
                      ),
                      child: Text(preset.$2),
                    ),
                ],
              ),
            ]),
            _section('IA', [
              SwitchListTile.adaptive(
                title: const Text('Confirmation des actions IA'),
                subtitle: const Text('Demander une confirmation avant une action importante ou destructive.'),
                value: _aiConfirmations,
                onChanged: (value) async {
                  setState(() => _aiConfirmations = value);
                  await _ai.setConfirmActions(value);
                },
              ),
              SwitchListTile.adaptive(
                title: const Text('Mémoire IA'),
                subtitle: const Text('Autoriser la mémoire persistante contrôlable par l’utilisateur.'),
                value: _memory,
                onChanged: (value) async {
                  await _ai.setMemoryEnabled(value);
                  setState(() => _memory = value);
                },
              ),
            ]),
            _section('Données & confidentialité', [
              SwitchListTile.adaptive(
                title: const Text('Synchronisation entre appareils'),
                subtitle: const Text('Autoriser la sauvegarde des préférences et données fonctionnelles sur les autres appareils Pace. Les opérations locales restent en attente tant que cette option est désactivée.'),
                value: _syncCloudConsent,
                onChanged: (value) => _setConsent('sync_cloud', value),
              ),
              SwitchListTile.adaptive(title: const Text('Accès aux données de santé'), subtitle: const Text('Autoriser Pace à lire les données Santé / Health Connect sélectionnées.'), value: _healthConsent, onChanged: (value) => _setConsent('health_data', value)),
              SwitchListTile.adaptive(title: const Text('Synchronisation santé cloud'), subtitle: const Text('Autoriser l’envoi des données de santé vers votre compte Pace.'), value: _healthCloudConsent, onChanged: _healthConsent ? (value) => _setConsent('health_cloud_sync', value) : null),
              SwitchListTile.adaptive(title: const Text('Données financières'), subtitle: const Text('Autoriser le traitement des données financières connectées.'), value: _financialConsent, onChanged: (value) => _setConsent('financial_data', value)),
              SwitchListTile.adaptive(title: const Text('Traitement IA'), subtitle: const Text('Autoriser l’utilisation des données nécessaires aux fonctions IA.'), value: _aiConsent, onChanged: (value) => _setConsent('ai_processing', value)),
              SwitchListTile.adaptive(title: const Text('Marketing'), subtitle: const Text('Autoriser les communications et mesures marketing.'), value: _marketingConsent, onChanged: (value) => _setConsent('marketing', value)),
              ListTile(
                title: const Text('Supprimer mon compte'),
                subtitle: const Text('Créer une demande de suppression de toutes les données Pace associées.'),
                trailing: FilledButton.tonal(onPressed: _deleting ? null : _requestDeletion, child: Text(_deleting ? '…' : 'Supprimer')),
              ),
            ]),
            _section('Notifications', [
              SwitchListTile.adaptive(
                title: const Text('Notifications Pace'),
                value: _notifications,
                onChanged: _setNotification,
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
