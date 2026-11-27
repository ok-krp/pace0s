import 'dart:io';
import 'dart:typed_data';

import 'package:material_ui/material_ui.dart';
import 'package:path_provider/path_provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/storage/local_store.dart';

class PaceTheme {
  static ThemeData light({String visualTheme = 'default'}) =>
      _theme(Brightness.light, visualTheme);
  static ThemeData dark({String visualTheme = 'default'}) =>
      _theme(Brightness.dark, visualTheme);

  static ThemeData _theme(Brightness brightness, String visualTheme) {
    final glass = visualTheme == 'glass';
    final neutral = glass || visualTheme == 'signal';
    final scheme = ColorScheme.fromSeed(
      seedColor: neutral ? const Color(0xFF777777) : const Color(0xFF7C6FF2),
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
    this.wallpaperOverride,
    this.sharedWallpaperOwnerId,
    required this.child,
  });

  final LocalStore localStore;
  final SupabaseClient? client;
  final Map<String, dynamic>? wallpaperOverride;
  final String? sharedWallpaperOwnerId;
  final Widget child;

  static final Map<String, Future<Uint8List>> _downloads = {};

  /// Remove private cached wallpaper data after an incoming share is revoked
  /// or the recipient switches to another source account.
  static Future<void> purgeSharedWallpaperCache(String ownerId) async {
    if (!RegExp(
      r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
      caseSensitive: false,
    ).hasMatch(ownerId)) {
      return;
    }

    final prefix = '$ownerId/';
    final pending = <Future<Uint8List>>[];
    for (final path in _downloads.keys.where((path) => path.startsWith(prefix)).toList()) {
      final future = _downloads.remove(path);
      if (future != null) pending.add(future);
    }
    for (final future in pending) {
      try {
        await future;
      } catch (_) {}
    }

    final directory = await getApplicationSupportDirectory();
    final encodedPrefix = 'pace_wallpaper_${Uri.encodeComponent(prefix)}';
    await for (final entity in directory.list(followLinks: false)) {
      if (entity is! File) continue;
      final fileName = entity.path.split(Platform.pathSeparator).last;
      if (!fileName.startsWith(encodedPrefix) || !fileName.endsWith('.cache')) continue;
      try {
        await entity.delete();
      } catch (_) {}
    }
  }

  /// Removes one replaced shared wallpaper from memory and persistent cache.
  static Future<void> purgeSharedWallpaperPath(String path) async {
    final slash = path.indexOf('/');
    final ownerId = slash > 0 ? path.substring(0, slash) : '';
    final filename = slash > 0 ? path.substring(slash + 1) : '';
    if (!RegExp(
          r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
          caseSensitive: false,
        ).hasMatch(ownerId) ||
        !RegExp(r'^[A-Za-z0-9._-]+\.(jpg|png|webp)$', caseSensitive: false)
            .hasMatch(filename)) {
      return;
    }

    final pending = _downloads.remove(path);
    if (pending != null) {
      try {
        await pending;
      } catch (_) {}
    }

    final directory = await getApplicationSupportDirectory();
    final cacheName = Uri.encodeComponent(path);
    final cachedFile = File(
      '${directory.path}/pace_wallpaper_$cacheName.cache',
    );
    try {
      if (await cachedFile.exists()) await cachedFile.delete();
    } catch (_) {}
  }
  static Future<Uint8List> _loadStorageWallpaper(
    SupabaseClient client,
    String path,
  ) {
    final cached = _downloads[path];
    if (cached != null) return cached;

    late final Future<Uint8List> request;
    request = (() async {
      final directory = await getApplicationSupportDirectory();
      // Keep the cache filename stable across app launches.
      final cacheName = Uri.encodeComponent(path);
      final cachedFile = File(
        '${directory.path}/pace_wallpaper_$cacheName.cache',
      );
      if (await cachedFile.exists()) return cachedFile.readAsBytes();
      final bytes = await client.storage.from('pace-wallpapers').download(path);
      await cachedFile.writeAsBytes(bytes, flush: true);
      return bytes;
    })().catchError((Object error) {
      if (identical(_downloads[path], request)) _downloads.remove(path);
      throw error;
    });
    _downloads[path] = request;
    return request;
  }
  Widget _wallpaper(
    BuildContext context,
    dynamic choice, {
    String? sharedOwnerId,
  }) {
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
      if (sharedOwnerId == null && localPath is String && localPath.isNotEmpty) {
        return Image.file(
          File(localPath),
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => fallback,
        );
      }
      final storagePath = choice['storagePath'];
      final userId = client?.auth.currentUser?.id;
      final ownerId = sharedOwnerId;
      final isSharedOwnerPath = ownerId != null &&
          RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', caseSensitive: false)
              .hasMatch(ownerId) &&
          storagePath is String &&
          storagePath.startsWith('$ownerId/');
      final pathOwnerId = isSharedOwnerPath ? ownerId : userId;
      final filename = storagePath is String && pathOwnerId != null &&
              storagePath.startsWith('$pathOwnerId/')
          ? storagePath.substring(pathOwnerId.length + 1)
          : '';
      if (storagePath is String &&
          userId != null &&
          localStore.currentAccountId == userId &&
          pathOwnerId != null &&
          RegExp(r'^[A-Za-z0-9._-]+\.(jpg|png|webp)$', caseSensitive: false)
              .hasMatch(filename) &&
          (isSharedOwnerPath || storagePath.startsWith('$userId/')) &&
          client != null) {
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
    final choice = wallpaperOverride ??
        localStore.read('pace.wallpaper') ??
        const {'id': 'graphite'};
    return Stack(
      fit: StackFit.expand,
      children: [
        _wallpaper(context, choice, sharedOwnerId: sharedWallpaperOwnerId),
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
