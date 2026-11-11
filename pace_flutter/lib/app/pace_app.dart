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
  Future<void> _accountSwitchQueue = Future<void>.value();
  bool _configured = false;
  bool _signedIn = false;
  bool _ready = false;
  String? _activationError;

  @override
  void initState() {
    super.initState();
    _configured = widget.auth.client != null;
    _signedIn = widget.auth.currentUser != null;
    _ready = !_configured;
    if (_configured) {
      _subscription = widget.auth.authStateChanges.listen((state) {
        _scheduleAccountSwitch(state.session?.user.id);
      });
      _scheduleAccountSwitch(widget.auth.currentUser?.id);
    }
  }

  void _scheduleAccountSwitch(String? userId) {
    if (!mounted) return;
    setState(() {
      _ready = false;
      _activationError = null;
    });
    _accountSwitchQueue = _accountSwitchQueue.then<void>(
      (_) => _applyAccountSwitch(userId),
      onError: (Object _, StackTrace __) => _applyAccountSwitch(userId),
    );
  }

  Future<void> _applyAccountSwitch(String? userId) async {
    try {
      // Stop the previous account's Realtime listeners and invalidate its
      // consent cache before changing the local snapshot or starting a sync.
      await widget.sync.onAccountChanged(userId);
      if (userId != null) {
        await widget.localStore.activateAccount(userId);
      } else if (widget.localStore.currentAccountId != null) {
        // A cold launch after sign-out must never display the last account's
        // local snapshot while the auth gate is showing the login screen.
        await widget.localStore.activateAccount(null);
      }
      if (!mounted) return;
      setState(() {
        _signedIn = userId != null;
        _ready = true;
        _activationError = null;
      });
      if (userId != null) await widget.sync.syncNow();
    } catch (error) {
      if (!mounted) return;
      // Fail closed: never render one account's local data after an account
      // namespace switch failed.
      setState(() {
        _ready = true;
        _activationError = error.toString();
      });
    }
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_configured) {
      return PaceShell(
        localStore: widget.localStore,
        sync: widget.sync,
        auth: widget.auth,
        onThemeChanged: widget.onThemeChanged,
        themeMode: widget.themeMode,
      );
    }
    if (!_ready) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (_activationError != null) {
      return Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              'Impossible de sécuriser les données locales de ce compte. '
              'Pace a bloqué leur affichage pour éviter un mélange entre comptes. '
              'Détail : $_activationError',
              textAlign: TextAlign.center,
            ),
          ),
        ),
      );
    }
    return _signedIn
        ? PaceShell(
            localStore: widget.localStore,
            sync: widget.sync,
            auth: widget.auth,
            onThemeChanged: widget.onThemeChanged,
            themeMode: widget.themeMode,
          )
        : AuthPage(auth: widget.auth);
  }
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
      NutritionPage(localStore: widget.localStore, sync: widget.sync),
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
