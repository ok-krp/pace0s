import 'dart:async';

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/storage/local_store.dart';
import '../core/supabase/pace_supabase.dart';
import '../core/sync/sync_service.dart';
import '../features/auth/auth_page.dart';
import '../features/dashboard/dashboard_page.dart';
import '../features/nutrition/nutrition_page.dart';
import '../features/sleep/sleep_page.dart';
import '../features/settings/settings_page.dart';
import '../ui/pace_theme.dart';

class PaceApp extends StatelessWidget {
  const PaceApp({super.key, required this.localStore, required this.auth, required this.sync});

  final LocalStore localStore;
  final PaceAuthService auth;
  final SyncService sync;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Pace',
      debugShowCheckedModeBanner: false,
      theme: PaceTheme.light(),
      darkTheme: PaceTheme.dark(),
      themeMode: ThemeMode.system,
      home: _AuthGate(localStore: localStore, auth: auth, sync: sync),
    );
  }
}

class _AuthGate extends StatefulWidget {
  const _AuthGate({required this.localStore, required this.auth, required this.sync});

  final LocalStore localStore;
  final PaceAuthService auth;
  final SyncService sync;

  @override
  State<_AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<_AuthGate> {
  StreamSubscription<AuthState>? _authSubscription;
  bool _signedIn = false;
  bool _configured = false;

  @override
  void initState() {
    super.initState();
    _configured = widget.auth.client != null;
    _signedIn = widget.auth.currentUser != null;
    if (_configured) {
      _authSubscription = widget.auth.authStateChanges.listen((state) {
        if (!mounted) return;
        setState(() => _signedIn = state.session != null);
        if (state.session != null) unawaited(widget.sync.syncNow());
      });
      if (_signedIn) unawaited(widget.sync.syncNow());
    }
  }

  @override
  void dispose() {
    _authSubscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_configured || _signedIn) {
      return PaceShell(localStore: widget.localStore, sync: widget.sync, auth: widget.auth);
    }
    return AuthPage(auth: widget.auth);
  }
}

class PaceShell extends StatefulWidget {
  const PaceShell({super.key, required this.localStore, required this.sync, required this.auth});

  final LocalStore localStore;
  final SyncService sync;
  final PaceAuthService auth;

  @override
  State<PaceShell> createState() => _PaceShellState();
}

class _PaceShellState extends State<PaceShell> {
  int _index = 0;
  Timer? _syncTimer;

  @override
  void initState() {
    super.initState();
    _syncTimer = Timer.periodic(const Duration(seconds: 15), (_) => unawaited(widget.sync.syncNow()));
  }

  @override
  void dispose() {
    _syncTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final pages = <Widget>[
      DashboardPage(localStore: widget.localStore),
      const NutritionPage(),
      const SleepPage(),
      SettingsPage(auth: widget.auth),
    ];

    return Scaffold(
      body: SafeArea(child: IndexedStack(index: _index, children: pages)),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (value) => setState(() => _index = value),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: 'Accueil'),
          NavigationDestination(icon: Icon(Icons.restaurant_outlined), selectedIcon: Icon(Icons.restaurant), label: 'Nutrition'),
          NavigationDestination(icon: Icon(Icons.bedtime_outlined), selectedIcon: Icon(Icons.bedtime), label: 'Sommeil'),
          NavigationDestination(icon: Icon(Icons.settings_outlined), selectedIcon: Icon(Icons.settings), label: 'Paramètres'),
        ],
      ),
    );
  }
}
