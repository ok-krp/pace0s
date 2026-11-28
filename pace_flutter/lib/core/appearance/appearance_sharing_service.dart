import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../compliance/compliance_service.dart';

/// Secure account-to-account appearance sharing.
///
/// The remote appearance is an in-memory presentation overlay. It is never
/// written to LocalStore, so revoking a share restores the recipient's own
/// local preferences without a destructive merge.
class AppearanceSharingService extends ChangeNotifier {
  AppearanceSharingService(this.client);

  final SupabaseClient? client;

  String? _userId;
  int _generation = 0;
  int _refreshRequest = 0;
  RealtimeChannel? _channel;
  Timer? _reconcileTimer;
  Map<String, dynamic>? _appearance;
  bool _disposed = false;

  String? get activeUserId => _userId;
  Map<String, dynamic>? get sharedAppearance => _appearance == null
      ? null
      : Map<String, dynamic>.unmodifiable(_appearance!);

  bool get isFollowing => _appearance != null;

  String? get sharedOwnerUserId {
    final owner = _appearance?['ownerUserId'];
    return owner is String && _isUuid(owner) ? owner : null;
  }

  static bool _isUuid(String value) => RegExp(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        caseSensitive: false,
      ).hasMatch(value);

  static dynamic _unwrap(dynamic value) {
    var current = value;
    for (var depth = 0; depth < 8; depth++) {
      if (current is! Map ||
          current['version'] != 1 ||
          !current.containsKey('value')) {
        break;
      }
      current = current['value'];
    }
    return current;
  }

  String get effectiveVisualTheme {
    if (!isFollowing) return 'default';
    final value = _unwrap(_appearance?['visualTheme']);
    return const {'default', 'signal', 'glass'}.contains(value)
        ? value as String
        : 'default';
  }

  bool get effectiveDarkMode {
    if (!isFollowing) return false;
    final value = _unwrap(_appearance?['dark']);
    return value == true || value == 1 || value == '1' || value == 'true';
  }

  /// Returns a safe, allow-listed preset or exact owner-scoped Storage path.
  /// The server getter and Storage RLS remain the authorization boundaries.
  Map<String, dynamic>? get sharedWallpaper {
    if (!isFollowing) return null;
    final raw = _unwrap(_appearance?['wallpaper']);
    if (raw is! Map) return const {'id': 'graphite'};

    final record = Map<String, dynamic>.from(raw);
    final ownerId = sharedOwnerUserId;
    if (ownerId == null) return const {'id': 'graphite'};

    if (record['kind'] == 'custom' && record['storagePath'] is String) {
      final path = record['storagePath'] as String;
      final prefix = '$ownerId/';
      final filename = path.startsWith(prefix) ? path.substring(prefix.length) : '';
      if (RegExp(r'^[A-Za-z0-9._-]+\.(jpg|png|webp)$', caseSensitive: false)
          .hasMatch(filename)) {
        return {'kind': 'custom', 'storagePath': path};
      }
      return const {'id': 'graphite'};
    }

    const presets = {
      'aurora',
      'ocean',
      'sunset',
      'forest',
      'graphite',
      'orchid',
      'mist',
      'slate',
    };
    final id = record['id'];
    if (id is String && presets.contains(id)) return {'id': id};
    return const {'id': 'graphite'};
  }

  Future<void> activate(String? userId) async {
    if (_disposed) return;
    final sameUser = userId == _userId;
    if (sameUser && _channel != null) {
      await refresh();
      return;
    }

    final generation = ++_generation;
    _userId = userId;
    if (!sameUser) _appearance = null;
    await _removeChannel();
    _notifyIfCurrent(generation);

    final value = client;
    if (value == null ||
        userId == null ||
        value.auth.currentUser?.id != userId) {
      _reconcileTimer?.cancel();
      _reconcileTimer = null;
      return;
    }

    try {
      final consent = await PaceComplianceService(value).hasConsent('sync_cloud');
      if (_disposed || generation != _generation) return;
      if (!consent || value.auth.currentUser?.id != userId) {
        _reconcileTimer?.cancel();
        _reconcileTimer = null;
        if (!consent && !_disposed && generation == _generation && _userId == userId) {
          _appearance = null;
          await _removeChannel();
          _notifyIfCurrent(generation);
        }
        return;
      }

      _reconcileTimer ??= Timer.periodic(
        const Duration(seconds: 60),
        (_) {
          final currentUserId = _userId;
          if (_disposed || currentUserId == null) return;
          if (_channel == null) {
            unawaited(activate(currentUserId));
          } else {
            unawaited(refresh());
          }
        },
      );

      final channel = value.channel(
        'pace-appearance-share:$userId',
        opts: const RealtimeChannelConfig(private: true),
      );
      channel.onBroadcast(
        event: 'shared_appearance_changed',
        callback: (_) {
          if (_disposed || _userId != userId || value.auth.currentUser?.id != userId) {
            return;
          }
          unawaited(refresh());
        },
      );
      _channel = channel;
      channel.subscribe((status, error) {
        if (_disposed || _generation != generation) return;
        switch (status) {
          case RealtimeSubscribeStatus.subscribed:
            unawaited(refresh());
            break;
          case RealtimeSubscribeStatus.channelError:
          case RealtimeSubscribeStatus.timedOut:
          case RealtimeSubscribeStatus.closed:
            if (identical(_channel, channel)) {
              _channel = null;
              unawaited(value.removeChannel(channel));
            }
            break;
        }
      });
      await refresh();
    } catch (error) {
      debugPrint('[appearance-sharing] activation failed: $error');
    }
  }

  Future<void> reconcile() async {
    final userId = _userId;
    if (userId == null || _disposed) return;
    if (_channel == null) {
      await activate(userId);
    } else {
      await refresh();
    }
  }

  Future<void> refresh() async {
    final value = client;
    final userId = _userId;
    final generation = _generation;
    final request = ++_refreshRequest;
    if (_disposed || value == null || userId == null ||
        value.auth.currentUser?.id != userId) {
      return;
    }

    try {
      final consent = await PaceComplianceService(value).hasConsent('sync_cloud');
      if (_disposed ||
          generation != _generation ||
          request != _refreshRequest ||
          value.auth.currentUser?.id != userId) {
        return;
      }
      if (!consent) {
        _appearance = null;
        _reconcileTimer?.cancel();
        _reconcileTimer = null;
        await _removeChannel();
        if (!_disposed && generation == _generation && request == _refreshRequest) {
          _notifyIfCurrent(generation);
        }
        return;
      }

      final data = await value.rpc('get_shared_appearance');
      if (_disposed ||
          generation != _generation ||
          request != _refreshRequest ||
          value.auth.currentUser?.id != userId) {
        return;
      }
      if (data is Map && data['ownerUserId'] is String &&
          _isUuid(data['ownerUserId'] as String)) {
        _appearance = Map<String, dynamic>.from(data);
      } else {
        _appearance = null;
      }
      _notifyIfCurrent(generation);
    } catch (error) {
      // Preserve the last confirmed appearance during transient outages.
      debugPrint('[appearance-sharing] refresh failed: $error');
    }
  }

  Future<String> createInvite() async {
    final value = _requireCurrentAccount();
    final result = await value.rpc('create_appearance_share_invite');
    if (result is! String || !RegExp(r'^[0-9a-f]{64}$').hasMatch(result)) {
      throw StateError("Le serveur n'a pas renvoyé un code d'invitation valide.");
    }
    return result;
  }

  Future<String> acceptInvite(String token) async {
    final value = _requireCurrentAccount();
    final normalized = token.trim().toLowerCase();
    if (!RegExp(r'^[0-9a-f]{64}$').hasMatch(normalized)) {
      throw ArgumentError('Le code doit contenir 64 caractères hexadécimaux.');
    }
    final result = await value.rpc(
      'accept_appearance_share_invite',
      params: {'p_token': normalized},
    );
    await refresh();
    return result is String ? result : result.toString();
  }

  Future<List<Map<String, dynamic>>> listShares() async {
    final value = _requireCurrentAccount();
    final rows = await value.rpc('list_appearance_shares');
    if (rows is! List) return const [];
    return rows
        .whereType<Map>()
        .map((row) => Map<String, dynamic>.from(row))
        .toList(growable: false);
  }

  Future<bool> revokeShare(String otherUserId) async {
    if (!_isUuid(otherUserId)) {
      throw ArgumentError('Identifiant de compte invalide.');
    }
    final value = _requireCurrentAccount();
    final result = await value.rpc(
      'revoke_appearance_share',
      params: {'p_other_user_id': otherUserId},
    );
    await refresh();
    return result == true;
  }

  SupabaseClient _requireCurrentAccount() {
    final value = client;
    final userId = _userId;
    if (value == null ||
        userId == null ||
        value.auth.currentUser?.id != userId) {
      throw StateError('Connecte-toi au compte Pace actif pour gérer le partage.');
    }
    return value;
  }

  void _notifyIfCurrent(int generation) {
    if (!_disposed && generation == _generation) notifyListeners();
  }

  Future<void> _removeChannel() async {
    final previous = _channel;
    _channel = null;
    if (previous != null && client != null) {
      try {
        await client!.removeChannel(previous);
      } catch (_) {}
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    _reconcileTimer?.cancel();
    _reconcileTimer = null;
    unawaited(_removeChannel());
    super.dispose();
  }
}
