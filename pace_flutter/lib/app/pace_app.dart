import 'package:flutter/material.dart';

import '../core/storage/local_store.dart';
import '../ui/pace_theme.dart';
import '../features/dashboard/dashboard_page.dart';
import '../features/nutrition/nutrition_page.dart';
import '../features/sleep/sleep_page.dart';
import '../features/settings/settings_page.dart';

class PaceApp extends StatelessWidget {
  const PaceApp({super.key, required this.localStore});

  final LocalStore localStore;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Pace',
      debugShowCheckedModeBanner: false,
      theme: PaceTheme.light(),
      darkTheme: PaceTheme.dark(),
      themeMode: ThemeMode.system,
      home: PaceShell(localStore: localStore),
    );
  }
}

class PaceShell extends StatefulWidget {
  const PaceShell({super.key, required this.localStore});

  final LocalStore localStore;

  @override
  State<PaceShell> createState() => _PaceShellState();
}

class _PaceShellState extends State<PaceShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final pages = <Widget>[
      DashboardPage(localStore: widget.localStore),
      const NutritionPage(),
      const SleepPage(),
      const SettingsPage(),
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
