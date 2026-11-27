import 'dart:io';
import 'dart:typed_data';

import 'package:material_ui/material_ui.dart';
import 'package:path_provider/path_provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/storage/local_store.dart';
import '../core/storage/wallpaper_presets.dart';

class PaceTheme {
  static ThemeData light({String visualTheme = 'default'}) =>
      _theme(Brightness.light, visualTheme);
  static ThemeData dark({String visualTheme = 'default'}) =>
      _theme(Brightness.dark, visualTheme);

  static ThemeData _theme(Brightness brightness, String visualTheme) {
    final glass = visualTheme == 'glass';
    final scheme = ColorScheme.fromSeed(
      seedColor: glass ? const Color(0xFF777777) : const Color(0xFF7C6FF2),
      brightness: brightness,
    );
    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: glass
          ? Colors.transparent
          : brightness == Brightness.dark
              ? const Color(0xFF111214)
              : const Color(0xFFF5F5F7),
      canvasColor: glass
          ? (brightness == Brightness.dark
              ? const Color(0xD9141517)
              : const Color(0xD9F5F5F5))
          : null,
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: glass
            ? (brightness == Brightness.dark
                ? const Color(0xB8141517)
                : const Color(0xB8FFFFFF))
            : brightness == Brightness.dark
                ? const Color(0xCC1A1B1E)
                : const Color(0xCCFFFFFF),
        elevation: 0,
        indicatorColor: glass
            ? (brightness == Brightness.dark
                ? const Color(0xFF414246)
                : const Color(0xFFE1E1E3))
            : scheme.primaryContainer,
      ),
      cardTheme: CardThemeData(
        color: glass
            ? (brightness == Brightness.dark
                ? const Color(0xA61F2024)
                : const Color(0xB8FFFFFF))
            : null,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      ),
    );
  }
}

class PaceGlassCard extends StatelessWidget {
  const PaceGlassCard({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Card(
      color: dark ? const Color(0x661F2024) : const Color(0xB8FFFFFF),
      child: Padding(padding: const EdgeInsets.all(16), child: child),
    );
  }
}

/// Places the selected wallpaper behind the native shell. A private Storage
/// object is downloaded once per device and cached in application support.
class PaceWallpaperBackground extends StatelessWidget {
  const PaceWallpaperBackground({
    super.key,
    required this.localStore,
    required this.client,
    required this.child,
  });

  final LocalStore localStore;
  final SupabaseClient? client;
  final Widget child;

  static final Map<String, Future<Uint8List>> _downloads = {};

  static Future<Uint8List> _loadStorageWallpaper(
    SupabaseClient client,
    String path,
  ) {
    return _downloads.putIfAbsent(path, () async {
      final directory = await getApplicationSupportDirectory();
      final cachedFile = File(
        '${directory.path}/pace_wallpaper_${path.hashCode.abs()}.cache',
      );
      if (await cachedFile.exists()) return cachedFile.readAsBytes();
      final bytes = await client.storage.from('pace-wallpapers').download(path);
      await cachedFile.writeAsBytes(bytes, flush: true);
      return bytes;
    }).catchError((Object error) {
      _downloads.remove(path);
      throw error;
    });
  }

  Widget _wallpaper(BuildContext context, dynamic choice) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final fallback = DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: dark
              ? const [Color(0xFF111214), Color(0xFF303236), Color(0xFF17181A)]
              : const [Color(0xFFE5E5E7), Color(0xFFF8F8F9), Color(0xFFD8D8DB)],
        ),
      ),
    );

    if (choice is Map && choice['kind'] == 'custom') {
      final localPath = choice['localPath'];
      if (localPath is String && localPath.isNotEmpty) {
        return Image.file(
          File(localPath),
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => fallback,
        );
      }
      final storagePath = choice['storagePath'];
      if (storagePath is String && storagePath.isNotEmpty && client != null) {
        return FutureBuilder<Uint8List>(
          future: _loadStorageWallpaper(client!, storagePath),
          builder: (context, snapshot) {
            if (snapshot.hasData) {
              return Image.memory(snapshot.data!, fit: BoxFit.cover);
            }
            return fallback;
          },
        );
      }
    }

    final preset = choice is Map ? choice['id'] : null;
    final List<Color>? colors = switch (preset) {
      'aurora' => dark
          ? const [Color(0xFF1E2439), Color(0xFF202B45), Color(0xFF182A35)]
          : const [Color(0xFFFFF1D6), Color(0xFFE6F0FF), Color(0xFFE0FBFA)],
      'ocean' => dark
          ? const [Color(0xFF16314A), Color(0xFF132D3F), Color(0xFF183C43)]
          : const [Color(0xFFD8F0FB), Color(0xFFA8D9EE), Color(0xFFB7E9E6)],
      'sunset' => dark
          ? const [Color(0xFF4A211D), Color(0xFF371B39), Color(0xFF2D1C2A)]
          : const [Color(0xFFFFE4C8), Color(0xFFFFC7C4), Color(0xFFF9D1E4)],
      'forest' => dark
          ? const [Color(0xFF193A2C), Color(0xFF142C29), Color(0xFF1D3425)]
          : const [Color(0xFFDDF2E2), Color(0xFFBBDCC9), Color(0xFFE3EBD4)],
      'graphite' => dark
          ? const [Color(0xFF111315), Color(0xFF242629)]
          : const [Color(0xFFE5E5E7), Color(0xFFF8F8F9), Color(0xFFD8D8DB)],
      'orchid' => dark
          ? const [Color(0xFF30203B), Color(0xFF271C39), Color(0xFF38243E)]
          : const [Color(0xFFF2DDF7), Color(0xFFE3D8FA), Color(0xFFF0E0EF)],
      // Keep old native-only preset IDs renderable for clients that already synced them.
      'mist' => dark
          ? const [Color(0xFF202124), Color(0xFF45464A)]
          : const [Color(0xFFF3F3F4), Color(0xFFD9DADD)],
      'slate' => dark
          ? const [Color(0xFF0D0E10), Color(0xFF27292D)]
          : const [Color(0xFFD2D3D5), Color(0xFFECECEE)],
      _ => null,
    };
    if (colors == null) return fallback;
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: colors,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final choice = localStore.read('pace.wallpaper') ?? const {'id': 'graphite'};
    return Stack(
      fit: StackFit.expand,
      children: [
        _wallpaper(context, choice),
        DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: Theme.of(context).brightness == Brightness.dark
                  ? [Colors.black.withValues(alpha: 0.18), Colors.black.withValues(alpha: 0.36)]
                  : [Colors.white.withValues(alpha: 0.10), Colors.black.withValues(alpha: 0.08)],
            ),
          ),
        ),
        child,
      ],
    );
  }
}
