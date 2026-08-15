import 'dart:async';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/storage/local_store.dart';
import '../core/supabase/pace_supabase.dart';
import '../core/sync/sync_service.dart';
import '../features/auth/auth_page.dart';
import '../features/dashboard/dashboard_page.dart';
import '../features/more/more_page.dart';
import '../features/nutrition/nutrition_page.dart';
import '../features/sleep/sleep_page.dart';
import '../features/sport/sport_page.dart';
import '../ui/pace_theme.dart';

class PaceApp extends StatefulWidget {
  const PaceApp({super.key, required this.localStore, required this.auth, required this.sync});
  final LocalStore localStore;
  final PaceAuthService auth;
  final SyncService sync;

  @override
  State<PaceApp> createState() => _PaceAppState();
}

class _PaceAppState extends State<PaceApp> {
  ThemeMode _themeMode = ThemeMode.system;

  @override
  void initState() {
    super.initState();
    _themeMode = _themeModeFromValue(widget.localStore.read('pace.settings.theme'));
  }

  ThemeMode _themeModeFromValue(dynamic value) {
    switch (value) {
      case 'light':
        return ThemeMode.light;
      case 'dark':
        return ThemeMode.dark;
      default:
        return ThemeMode.system;
    }
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    setState(() => _themeMode = mode);
    await widget.localStore.write('pace.settings.theme', switch (mode) {
      ThemeMode.light => 'light',
      ThemeMode.dark => 'dark',
      ThemeMode.system => 'system',
    });
    unawaited(widget.sync.syncNow());
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Pace',
        debugShowCheckedModeBanner: false,
        theme: PaceTheme.light(),
        darkTheme: PaceTheme.dark(),
        themeMode: _themeMode,
        home: _AuthGate(
          localStore: widget.localStore,
          auth: widget.auth,
          sync: widget.sync,
          onThemeChanged: setThemeMode,
          themeMode: _themeMode,
        ),
      );
}

class _AuthGate extends StatefulWidget {
  const _AuthGate({
    required this.localStore,
    required this.auth,
    required this.sync,
    required this.onThemeChanged,
    required this.themeMode,
  });
  final LocalStore localStore;
  final PaceAuthService auth;
  final SyncService sync;
  final ValueChanged<ThemeMode> onThemeChanged;
  final ThemeMode themeMode;

  @override
  State<_AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<_AuthGate> {
  StreamSubscription<AuthState>? _subscription;
  bool _configured = false;
  bool _signedIn = false;

  @override
  void initState() {
    super.initState();
    _configured = widget.auth.client != null;
    _signedIn = widget.auth.currentUser != null;
    if (_configured) {
      _subscription = widget.auth.authStateChanges.listen((state) {
        if (!mounted) return;
        setState(() => _signedIn = state.session != null);
        if (state.session != null) unawaited(widget.sync.syncNow());
      });
      if (_signedIn) unawaited(widget.sync.syncNow());
    }
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => !_configured || _signedIn
      ? PaceShell(
          localStore: widget.localStore,
          sync: widget.sync,
          auth: widget.auth,
          onThemeChanged: widget.onThemeChanged,
          themeMode: widget.themeMode,
        )
      : AuthPage(auth: widget.auth);
}

class PaceShell extends StatefulWidget {
  const PaceShell({
    super.key,
    required this.localStore,
    required this.sync,
    required this.auth,
    required this.onThemeChanged,
    required this.themeMode,
  });
  final LocalStore localStore;
  final SyncService sync;
  final PaceAuthService auth;
  final ValueChanged<ThemeMode> onThemeChanged;
  final ThemeMode themeMode;

  @override
  State<PaceShell> createState() => _PaceShellState();
}

class _PaceShellState extends State<PaceShell> {
  int _index = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 15), (_) => unawaited(widget.sync.syncNow()));
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final pages = <Widget>[
      DashboardPage(localStore: widget.localStore),
      NutritionPage(localStore: widget.localStore),
      SportPage(localStore: widget.localStore),
      SleepPage(localStore: widget.localStore),
      MorePage(
        localStore: widget.localStore,
        sync: widget.sync,
        auth: widget.auth,
        themeMode: widget.themeMode,
        onThemeChanged: widget.onThemeChanged,
      ),
    ];
    return Scaffold(
      body: SafeArea(child: IndexedStack(index: _index, children: pages)),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (value) => setState(() => _index = value),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: 'Accueil'),
          NavigationDestination(icon: Icon(Icons.restaurant_outlined), selectedIcon: Icon(Icons.restaurant), label: 'Nutrition'),
          NavigationDestination(icon: Icon(Icons.fitness_center_outlined), selectedIcon: Icon(Icons.fitness_center), label: 'Sport'),
          NavigationDestination(icon: Icon(Icons.bedtime_outlined), selectedIcon: Icon(Icons.bedtime), label: 'Sommeil'),
          NavigationDestination(icon: Icon(Icons.apps_outlined), selectedIcon: Icon(Icons.apps), label: 'Plus'),
        ],
      ),
    );
  }
}
