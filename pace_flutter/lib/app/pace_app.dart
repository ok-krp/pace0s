import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/appearance/appearance_sharing_service.dart';
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
  String _visualTheme = 'default';
  late final AppearanceSharingService _appearanceSharing;
  StreamSubscription<AuthState>? _appearanceAuthSubscription;

  @override
  void initState() {
    super.initState();
    _appearanceSharing = AppearanceSharingService(widget.auth.client);
    _appearanceSharing.addListener(_onSharedAppearanceChange);
    _appearanceAuthSubscription = widget.auth.authStateChanges.listen((state) {
      unawaited(_appearanceSharing.activate(state.session?.user.id));
    });
    unawaited(_appearanceSharing.activate(widget.auth.currentUser?.id));
    _readAppearance();
    widget.localStore.addChangeListener(_onLocalStoreChange);
  }

  void _readAppearance() {
    if (_appearanceSharing.isFollowing &&
        _appearanceSharing.activeUserId == widget.auth.currentUser?.id) {
      _visualTheme = _appearanceSharing.effectiveVisualTheme;
      _themeMode = _visualTheme == 'glass' || _appearanceSharing.effectiveDarkMode
          ? ThemeMode.dark
          : ThemeMode.light;
      return;
    }
    final storedTheme = widget.localStore.read('pace.visual-theme');
    final visualTheme = storedTheme is String &&
            const {'default', 'signal', 'glass'}.contains(storedTheme)
        ? storedTheme
        : 'default';
    final storedDark = widget.localStore.read('pace.dark');
    final legacyTheme = widget.localStore.read('pace.settings.theme');
    final dark = visualTheme == 'glass' ||
        (storedDark != null
            ? storedDark == '1' || storedDark == true
            : legacyTheme == 'dark');
    _visualTheme = visualTheme;
    _themeMode = dark ? ThemeMode.dark : ThemeMode.light;
  }

  String? _lastSharedWallpaperOwnerId;

  void _onSharedAppearanceChange() {
    if (!mounted) return;
    final nextOwnerId = _appearanceSharing.sharedOwnerUserId;
    final previousOwnerId = _lastSharedWallpaperOwnerId;
    if (previousOwnerId != null && previousOwnerId != nextOwnerId) {
      unawaited(PaceWallpaperBackground.purgeSharedWallpaperCache(previousOwnerId));
    }
    _lastSharedWallpaperOwnerId = nextOwnerId;
    setState(_readAppearance);
  }

  void _onLocalStoreChange(String key) {
    if (key != '*' &&
        key != 'pace.visual-theme' &&
        key != 'pace.dark' &&
        key != 'pace.wallpaper') {
      return;
    }
    if (!mounted) return;
    setState(_readAppearance);
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    if (_appearanceSharing.isFollowing) return;
    final effectiveMode = _visualTheme == 'glass' ? ThemeMode.dark : mode;
    setState(() => _themeMode = effectiveMode);
    await widget.localStore.write(
      'pace.dark',
      effectiveMode == ThemeMode.dark ? '1' : '0',
    );
  }

  Future<void> setVisualTheme(String theme) async {
    if (_appearanceSharing.isFollowing) return;
    if (!const {'default', 'signal', 'glass'}.contains(theme)) return;
    setState(() {
      _visualTheme = theme;
      if (theme == 'glass') _themeMode = ThemeMode.dark;
    });
    await widget.localStore.write('pace.visual-theme', theme);
  }

  @override
  void dispose() {
    widget.localStore.removeChangeListener(_onLocalStoreChange);
    _appearanceAuthSubscription?.cancel();
    _appearanceSharing.removeListener(_onSharedAppearanceChange);
    _appearanceSharing.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Pace',
        debugShowCheckedModeBanner: false,
        theme: PaceTheme.light(visualTheme: _visualTheme),
        darkTheme: PaceTheme.dark(visualTheme: _visualTheme),
        themeMode: _themeMode,
        home: _AuthGate(
          localStore: widget.localStore,
          auth: widget.auth,
          sync: widget.sync,
          appearanceSharing: _appearanceSharing,
          onThemeChanged: setThemeMode,
          onVisualThemeChanged: setVisualTheme,
          themeMode: _themeMode,
          visualTheme: _visualTheme,
        ),
      );
}

class _AuthGate extends StatefulWidget {
  const _AuthGate({
    required this.localStore,
    required this.auth,
    required this.sync,
    required this.appearanceSharing,
    required this.onThemeChanged,
    required this.onVisualThemeChanged,
    required this.themeMode,
    required this.visualTheme,
  });
  final LocalStore localStore;
  final PaceAuthService auth;
  final SyncService sync;
  final AppearanceSharingService appearanceSharing;
  final ValueChanged<ThemeMode> onThemeChanged;
  final ValueChanged<String> onVisualThemeChanged;
  final ThemeMode themeMode;
  final String visualTheme;

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
    _ready = false;
    if (_configured) {
      _subscription = widget.auth.authStateChanges.listen((state) {
        _scheduleAccountSwitch(state.session?.user.id);
      });
      _scheduleAccountSwitch(widget.auth.currentUser?.id);
    } else {
      // A build without Supabase configuration must not display a previously
      // authenticated account's private local snapshot.
      _scheduleAccountSwitch(null);
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
      // Auth events may arrive in quick succession. Ignore an obsolete event
      // before it is allowed to switch the local namespace.
      if (widget.auth.currentUser?.id != userId) return;
      // Stop the previous account's Realtime listeners and invalidate its
      // consent cache before changing the local snapshot or starting a sync.
      await widget.sync.onAccountChanged(userId);
      if (widget.auth.currentUser?.id != userId) return;
      if (userId != null) {
        await widget.localStore.activateAccount(userId);
      } else if (widget.localStore.currentAccountId != null) {
        // A cold launch after sign-out must never display the last account's
        // local snapshot while the auth gate is showing the login screen.
        await widget.localStore.activateAccount(null);
      }
      if (widget.auth.currentUser?.id != userId) return;
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
    if (!_ready) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (!_configured) {
      return PaceShell(
        localStore: widget.localStore,
        sync: widget.sync,
        auth: widget.auth,
        appearanceSharing: widget.appearanceSharing,
        onThemeChanged: widget.onThemeChanged,
        onVisualThemeChanged: widget.onVisualThemeChanged,
        themeMode: widget.themeMode,
        visualTheme: widget.visualTheme,
      );
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
            appearanceSharing: widget.appearanceSharing,
            onThemeChanged: widget.onThemeChanged,
            onVisualThemeChanged: widget.onVisualThemeChanged,
            themeMode: widget.themeMode,
            visualTheme: widget.visualTheme,
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
    required this.appearanceSharing,
    required this.onThemeChanged,
    required this.onVisualThemeChanged,
    required this.themeMode,
    required this.visualTheme,
  });
  final LocalStore localStore;
  final SyncService sync;
  final PaceAuthService auth;
  final AppearanceSharingService appearanceSharing;
  final ValueChanged<ThemeMode> onThemeChanged;
  final ValueChanged<String> onVisualThemeChanged;
  final ThemeMode themeMode;
  final String visualTheme;

  @override
  State<PaceShell> createState() => _PaceShellState();
}

class _PaceShellState extends State<PaceShell> with WidgetsBindingObserver {
  int _index = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _timer = Timer.periodic(
      const Duration(seconds: 60),
      (_) => unawaited(widget.sync.syncNow().catchError((Object _) {})),
    );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(widget.sync.syncNow().catchError((Object _) {}));
      unawaited(widget.appearanceSharing.reconcile());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
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
        appearanceSharing: widget.appearanceSharing,
        themeMode: widget.themeMode,
        visualTheme: widget.visualTheme,
        onThemeChanged: widget.onThemeChanged,
        onVisualThemeChanged: widget.onVisualThemeChanged,
      ),
    ];
    return PaceWallpaperBackground(
      localStore: widget.localStore,
      client: widget.auth.client,
      wallpaperOverride: widget.appearanceSharing.sharedWallpaper,
      sharedWallpaperOwnerId: widget.appearanceSharing.sharedOwnerUserId,
      child: Scaffold(
      backgroundColor: Colors.transparent,
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
      ),
    );
  }
}
