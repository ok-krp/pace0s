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

/// Returns true only for a duplicate session notification when no switch is
/// pending. A null-user event must still supersede an in-flight sign-in even
/// while the previous guest store remains active on disk.
bool shouldSkipAccountActivation({
  required bool activationInProgress,
  required String? activeUserId,
  required String? requestedUserId,
  required bool signedIn,
}) =>
    !activationInProgress &&
    activeUserId == requestedUserId &&
    ((requestedUserId == null && !signedIn) ||
        (requestedUserId != null && signedIn));


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
  bool _offlineMode = false;
  bool _offlineRequested = false;
  // A sign-out event can arrive while the guest file is still being activated.
  // Remember it so the event is not lost before offline mode becomes visible.
  bool _signedOutDuringOfflineTransition = false;

  int _accountGeneration = 0;
  bool _accountActivationInProgress = false;

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
        if (!mounted) return;
        final userId = state.session?.user.id;
        // An explicit offline choice wins over token-refresh/session events.
        // A real sign-out exits offline mode so the auth screen can be shown.
        if (_offlineRequested) {
          if (userId != null) return;
          // Ignore initial-session/other null-user events while offline. Only
          // a real sign-out should leave the explicitly selected local mode.
          if (state.event != AuthChangeEvent.signedOut) return;
          // A sign-out event can race the await in _continueOffline(). If
          // the guest shell is not visible yet, defer handling until activation
          // completes instead of dropping the event permanently.
          if (!_offlineMode) {
            _signedOutDuringOfflineTransition = true;
            return;
          }
          _offlineRequested = false;
          if (_offlineMode) {
            // Offline shell routes use the root navigator. Clear them even
            // when the LocalStore scope remains guest/null after sign-out.
            Navigator.maybeOf(context, rootNavigator: true)
                ?.popUntil((route) => route.isFirst);
            if (mounted) setState(() => _offlineMode = false);
          }
        }
        unawaited(_activateAccount(userId));
      });
    }
  }

  Future<void> _activateAccount(String? userId) async {
    // Supabase emits token-refresh and other same-session auth events. Do not
    // hide and recreate the signed-in shell unless the account actually changes
    // or a previous account activation failed and needs another attempt.
    if (shouldSkipAccountActivation(
      activationInProgress: _accountActivationInProgress,
      activeUserId: widget.localStore.activeUserId,
      requestedUserId: userId,
      signedIn: _signedIn,
    )) {
      return;
    }

    final generation = ++_accountGeneration;
    _accountActivationInProgress = true;
    if (widget.localStore.activeUserId != userId) {
      // Feature routes are pushed onto MaterialApp's root navigator. Remove
      // them before every account-scope transition, including guest/offline
      // mode, so cached routes cannot survive a later sign-in or sign-out.
      Navigator.maybeOf(context, rootNavigator: true)
          ?.popUntil((route) => route.isFirst);
    }
    if (mounted) setState(() => _signedIn = false);

    try {
      await widget.localStore.activateAccount(userId);
    } catch (_) {
      // Fail closed: keep the authenticated shell hidden if account-local
      // storage cannot be switched safely.
      if (generation == _accountGeneration) {
        _accountActivationInProgress = false;
      }
      return;
    }

    if (!mounted || generation != _accountGeneration) return;
    final storedTheme = switch (widget.localStore.read('pace.settings.theme')) {
      'light' => ThemeMode.light,
      'dark' => ThemeMode.dark,
      _ => ThemeMode.system,
    };
    widget.onThemeLoaded(storedTheme);
    setState(() {
      _signedIn = userId != null;
      _offlineMode = false;
    });
    _accountActivationInProgress = false;
    if (userId != null) await widget.sync.syncNow();
  }

  void _exitOffline() {
    if (!mounted) return;
    _offlineRequested = false;

    // Choosing local mode does not sign out of Supabase. If a valid session
    // still exists, restore its account-scoped store instead of leaving the
    // user on the login form with an already-authenticated client.
    final currentUser = widget.auth.currentUser;
    if (currentUser != null) {
      unawaited(_activateAccount(currentUser.id));
      return;
    }

    setState(() => _offlineMode = false);
  }

  Future<void> _continueOffline() async {
    // The auth screen remains mounted during file I/O. Ignore repeated taps so
    // a second request cannot reset a sign-out event observed by the first.
    if (_offlineRequested) return;
    // Set synchronously before the first await so auth events cannot race this
    // choice and reactivate the previously authenticated account's file.
    _offlineRequested = true;
    _signedOutDuringOfflineTransition = false;
    final generation = ++_accountGeneration;
    _accountActivationInProgress = true;
    try {
      // Switch to the guest/local file before showing the shell. Never leave
      // a previously authenticated account's local state active in offline mode.
      await widget.localStore.activateAccount(null);
    } catch (_) {
      // A stale failed attempt must not cancel a newer offline request.
      if (generation == _accountGeneration) {
        _offlineRequested = false;
        _signedOutDuringOfflineTransition = false;
        _accountActivationInProgress = false;
      }
      return;
    }
    if (!mounted || generation != _accountGeneration) return;
    if (_signedOutDuringOfflineTransition) {
      _signedOutDuringOfflineTransition = false;
      _offlineRequested = false;
      _accountActivationInProgress = false;
      setState(() {
        _signedIn = false;
        _offlineMode = false;
      });
      return;
    }
    final storedTheme = switch (widget.localStore.read('pace.settings.theme')) {
      'light' => ThemeMode.light,
      'dark' => ThemeMode.dark,
      _ => ThemeMode.system,
    };
    widget.onThemeLoaded(storedTheme);
    setState(() {
      _signedIn = false;
      _offlineMode = true;
    });
    _accountActivationInProgress = false;
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
    // Explicit offline mode must not expose a still-cached Supabase session to
    // guest-scoped feature services. In particular, AI local storage rejects
    // guest operations if its auth service still reports a signed-in user.
    final shellAuth = _offlineMode ? const PaceAuthService(null) : widget.auth;
    if (_signedIn || _offlineMode) {
      return PaceShell(
        localStore: widget.localStore,
        sync: widget.sync,
        auth: shellAuth,
        offlineMode: _offlineMode,
        onExitOffline: _exitOffline,
        onThemeChanged: (mode) {
          if (widget.localStore.activeUserId != shellUserId) return;
          widget.onThemeChanged(mode);
        },
        themeMode: widget.themeMode,
      );
    }
    return AuthPage(
      auth: widget.auth,
      onContinueOffline: _continueOffline,
    );
  }
}

class PaceShell extends StatefulWidget {
  const PaceShell({
    super.key,
    required this.localStore,
    required this.sync,
    required this.auth,
    required this.offlineMode,
    required this.onExitOffline,
    required this.onThemeChanged,
    required this.themeMode,
  });
  final LocalStore localStore;
  final SyncService sync;
  final PaceAuthService auth;
  final bool offlineMode;
  final VoidCallback onExitOffline;
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
        offlineMode: widget.offlineMode,
        onExitOffline: widget.onExitOffline,
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
