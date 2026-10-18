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
    final expectedUserId = widget.localStore.activeUserId;
    setState(() => _themeMode = mode);
    await widget.localStore.writeForAccount(expectedUserId, 'pace.settings.theme', switch (mode) {
      ThemeMode.light => 'light',
      ThemeMode.dark => 'dark',
      ThemeMode.system => 'system',
    });
    if (widget.localStore.activeUserId == expectedUserId) {
      unawaited(widget.sync.syncNow());
    }
  }

  // Account switching loads a different local settings file. Apply its theme
  // without writing it back or creating an unnecessary sync mutation.
  void _applyStoredThemeMode(ThemeMode mode) {
    if (!mounted) return;
    setState(() => _themeMode = mode);
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
          onThemeLoaded: _applyStoredThemeMode,
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
    required this.onThemeLoaded,
    required this.themeMode,
  });
  final LocalStore localStore;
  final PaceAuthService auth;
  final SyncService sync;
  final ValueChanged<ThemeMode> onThemeChanged;
  final ValueChanged<ThemeMode> onThemeLoaded;
  final ThemeMode themeMode;

  @override
  State<_AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<_AuthGate> {
  StreamSubscription<AuthState>? _subscription;
  bool _configured = false;
  bool _signedIn = false;

  int _accountGeneration = 0;

  @override
  void initState() {
    super.initState();
    _configured = widget.auth.client != null;
    // Do not render a signed-in shell until its account-specific local store
    // has been loaded. This prevents a previous account's data flashing on
    // screen during app startup or account switching.
    _signedIn = false;
    if (_configured) {
      final currentUser = widget.auth.currentUser;
      if (currentUser != null) unawaited(_activateAccount(currentUser.id));
      _subscription = widget.auth.authStateChanges.listen((state) {
        unawaited(_activateAccount(state.session?.user.id));
      });
    }
  }

  Future<void> _activateAccount(String? userId) async {
    // Supabase emits token-refresh and other same-session auth events. Do not
    // hide and recreate the signed-in shell unless the account actually changes
    // or a previous account activation failed and needs another attempt.
    if (widget.localStore.activeUserId == userId &&
        ((userId == null && !_signedIn) || (userId != null && _signedIn))) {
      return;
    }

    final generation = ++_accountGeneration;
    if (_signedIn && widget.localStore.activeUserId != userId) {
      // Feature routes are pushed onto MaterialApp's root navigator. Remove
      // them before changing account scope so a signed-out account cannot leave
      // a cached page visible above the authentication screen.
      Navigator.maybeOf(context, rootNavigator: true)
          ?.popUntil((route) => route.isFirst);
    }
    if (mounted) setState(() => _signedIn = false);

    try {
      await widget.localStore.activateAccount(userId);
    } catch (_) {
      // Fail closed: keep the authenticated shell hidden if account-local
      // storage cannot be switched safely.
      return;
    }

    if (!mounted || generation != _accountGeneration) return;
    final storedTheme = switch (widget.localStore.read('pace.settings.theme')) {
      'light' => ThemeMode.light,
      'dark' => ThemeMode.dark,
      _ => ThemeMode.system,
    };
    widget.onThemeLoaded(storedTheme);
    setState(() => _signedIn = userId != null);
    if (userId != null) await widget.sync.syncNow();
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Capture the account that owns this shell. A delayed callback from a
    // disposed shell must not apply its theme choice to the next account.
    final shellUserId = widget.localStore.activeUserId;
    if (!_configured || _signedIn) {
      return PaceShell(
        localStore: widget.localStore,
        sync: widget.sync,
        auth: widget.auth,
        onThemeChanged: (mode) {
          if (widget.localStore.activeUserId != shellUserId) return;
          widget.onThemeChanged(mode);
        },
        themeMode: widget.themeMode,
      );
    }
    return AuthPage(auth: widget.auth);
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
    // Bound background polling to reduce repeated full user_state reads.
    // Cross-device updates may take up to one minute between polling cycles.
    _timer = Timer.periodic(const Duration(seconds: 60), (_) => unawaited(widget.sync.syncNow()));
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
