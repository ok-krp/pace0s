import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// Durable local state used by the native app. It is independent from the web
/// application and is safe to use while completely offline.
class LocalStore {
  LocalStore._(this._file);

  final File _file;
  Map<String, dynamic> _data = <String, dynamic>{};
  final Map<String, Map<String, dynamic>> _accounts = {};
  String _scope = '__unscoped__';
  Future<void> _flushQueue = Future<void>.value();

  /// The signed-in account owning the currently active local snapshot.
  /// Null means the unscoped legacy/guest workspace is active.
  String? get currentAccountId =>
      _scope.startsWith('account:') ? _scope.substring('account:'.length) : null;

  static Future<LocalStore> open() async {
    final directory = await getApplicationSupportDirectory();
    final file = File(p.join(directory.path, 'pace_local.json'));
    return openAt(file);
  }

  /// Opens a LocalStore at an explicit file path. Used by isolated storage
  /// tests; production callers should use [open].
  static Future<LocalStore> openAt(File file) async {
    final store = LocalStore._(file);
    final backup = File('${file.path}.bak');
    if (!await file.exists() && await backup.exists()) {
      // Recover the previous complete snapshot if the process stopped after
      // moving the original file aside but before promoting the new snapshot.
      await backup.rename(file.path);
    }
    if (await file.exists()) {
      try {
        final decoded = jsonDecode(await file.readAsString());
        if (decoded is Map<String, dynamic> &&
            decoded['__local_store_version'] == 2 &&
            decoded['__accounts'] is Map) {
          final rawAccounts = decoded['__accounts'] as Map;
          for (final entry in rawAccounts.entries) {
            if (entry.key is String && entry.value is Map) {
              store._accounts[entry.key as String] =
                  Map<String, dynamic>.from(entry.value as Map);
            }
          }
          final savedScope = decoded['__active_scope'];
          store._scope = savedScope is String ? savedScope : '__guest__';
          store._data = Map<String, dynamic>.from(
            store._accounts[store._scope] ?? <String, dynamic>{},
          );
        } else if (decoded is Map<String, dynamic> &&
            decoded['__local_store_version'] == null) {
          // Version 1 was a single unscoped snapshot. Keep every value and
          // its outbox untouched until the first authenticated account claims it.
          store._data = decoded;
        } else {
          throw const FormatException('Unsupported or malformed local store format.');
        }
      } catch (_) {
        // Never turn an unreadable existing file into an empty store: a later
        // write would overwrite the only recoverable copy of the user's data.
        // Let the app fail closed and leave pace_local.json untouched.
        throw StateError(
          'Le stockage local pace_local.json est illisible. Le fichier original a été conservé pour récupération.',
        );
      }
      // A leftover backup is obsolete only after the promoted snapshot parsed.
      if (await backup.exists()) await backup.delete();
    }
    return store;
  }

  dynamic read(String key) => _data[key];

  String? lastSyncedAt(String key) => _syncMeta[key] as String?;

  /// Switches the active local snapshot without ever mixing account outboxes.
  /// The first authenticated account adopts the existing unscoped v1 data so
  /// a user's current offline work is preserved during this format upgrade.
  Future<void> activateAccount(String? userId) async {
    final targetScope = userId == null ? '__guest__' : 'account:$userId';
    if (_scope == targetScope) return;

    final currentSnapshot = Map<String, dynamic>.from(_data);
    if (userId != null &&
        !_accounts.containsKey(targetScope) &&
        (_scope == '__unscoped__' || _accounts.containsKey('__unscoped__'))) {
      // Auth startup commonly visits the signed-out guest scope before the
      // initial session is resolved. In that case the v1 snapshot has already
      // been parked under __unscoped__; claim it for the first account rather
      // than silently leaving the user's pre-upgrade offline data behind.
      final legacySnapshot = _scope == '__unscoped__'
          ? currentSnapshot
          : Map<String, dynamic>.from(_accounts['__unscoped__']!);
      if (_scope != '__unscoped__') {
        _accounts[_scope] = currentSnapshot;
      }
      _accounts[targetScope] = legacySnapshot;
      _accounts.remove('__unscoped__');
    } else {
      _accounts[_scope] = currentSnapshot;
    }

    _scope = targetScope;
    _data = Map<String, dynamic>.from(
      _accounts[targetScope] ?? <String, dynamic>{},
    );
    await _flush();
  }

  Future<void> write(String key, dynamic value, {bool enqueueSync = true}) async {
    _data[key] = value;
    if (enqueueSync) {
      final outbox = _outbox;
      outbox.removeWhere((entry) => entry['key'] == key);
      outbox.add({
        'key': key,
        'value': value,
        'operation': 'upsert',
        'queuedAt': DateTime.now().toUtc().toIso8601String(),
      });
      _data['__outbox'] = outbox;
    }
    await _flush();
  }

  Future<void> remove(String key, {bool enqueueSync = true}) async {
    _data.remove(key);
    if (enqueueSync) {
      final outbox = _outbox;
      outbox.removeWhere((entry) => entry['key'] == key);
      outbox.add({
        'key': key,
        'operation': 'delete',
        'queuedAt': DateTime.now().toUtc().toIso8601String(),
      });
      _data['__outbox'] = outbox;
    }
    await _flush();
  }

  Future<void> applyRemote(String key, dynamic value, String updatedAt) async {
    _data[key] = value;
    _setSyncedAt(key, updatedAt);
    await _flush();
  }

  Future<void> markSyncedAt(String key, String updatedAt) async {
    _setSyncedAt(key, updatedAt);
    await _flush();
  }

  Map<String, String> syncedMetadata() => Map<String, String>.from(_syncMeta);

  Map<String, dynamic> get _syncMeta {
    final raw = _data['__sync_meta'];
    if (raw is Map) return Map<String, dynamic>.from(raw);
    return <String, dynamic>{};
  }

  void _setSyncedAt(String key, String timestamp) {
    final meta = _syncMeta;
    meta[key] = timestamp;
    _data['__sync_meta'] = meta;
  }

  List<Map<String, dynamic>> get _outbox => ((_data['__outbox'] as List?) ?? const [])
      .whereType<Map>()
      .map((entry) => Map<String, dynamic>.from(entry))
      .toList();

  List<Map<String, dynamic>> pendingOperations() => List.unmodifiable(_outbox);

  Future<void> acknowledgeOperation(Map<String, dynamic> operation) async {
    final outbox = _outbox;
    final queuedAt = operation['queuedAt'];
    outbox.removeWhere((entry) {
      if (entry['key'] != operation['key']) return false;
      if (queuedAt != null) return entry['queuedAt'] == queuedAt;
      return entry['operation'] == operation['operation'] && entry['value'] == operation['value'];
    });
    _data['__outbox'] = outbox;
    await _flush();
  }

  /// Acknowledge a server-accepted mutation in the owner's namespace, even
  /// when the UI has already switched to a different account.
  Future<void> acknowledgeOperationForAccount(
    String userId,
    Map<String, dynamic> operation,
    String updatedAt,
  ) async {
    final scope = 'account:$userId';
    final snapshot = _scope == scope
        ? _data
        : _accounts[scope];
    if (snapshot == null) return;

    final rawMeta = snapshot['__sync_meta'];
    final meta = rawMeta is Map
        ? Map<String, dynamic>.from(rawMeta)
        : <String, dynamic>{};
    meta[operation['key'] as String] = updatedAt;
    snapshot['__sync_meta'] = meta;

    final rawOutbox = (snapshot['__outbox'] as List?) ?? const [];
    final outbox = rawOutbox
        .whereType<Map>()
        .map((entry) => Map<String, dynamic>.from(entry))
        .toList();
    final queuedAt = operation['queuedAt'];
    outbox.removeWhere((entry) {
      if (entry['key'] != operation['key']) return false;
      if (queuedAt != null) return entry['queuedAt'] == queuedAt;
      return entry['operation'] == operation['operation'] &&
          entry['value'] == operation['value'];
    });
    snapshot['__outbox'] = outbox;

    if (_scope != scope) _accounts[scope] = snapshot;
    await _flush();
  }

  Future<void> _flush() {
    // Capture the exact account state at the call boundary. Auth transitions
    // can overlap an outstanding disk write, so queued flushes must never read
    // a later account's mutable _scope/_data when they eventually execute.
    final scope = _scope;
    final accounts = <String, Map<String, dynamic>>{
      for (final entry in _accounts.entries)
        entry.key: Map<String, dynamic>.from(entry.value),
    };
    accounts[scope] = Map<String, dynamic>.from(_data);
    final persisted = <String, dynamic>{
      '__local_store_version': 2,
      '__active_scope': scope,
      '__accounts': accounts,
    };

    // A failed flush must not poison the queue forever; the next user mutation
    // gets an opportunity to retry while the current caller still sees its
    // own write error.
    final next = _flushQueue.catchError((_) {}).then((_) async {
      await _file.parent.create(recursive: true);
      final temporary = File('${_file.path}.tmp');
      final backup = File('${_file.path}.bak');
      await temporary.writeAsString(jsonEncode(persisted), flush: true);
      if (await backup.exists()) await backup.delete();

      final hadOriginal = await _file.exists();
      if (hadOriginal) await _file.rename(backup.path);
      try {
        await temporary.rename(_file.path);
      } catch (_) {
        if (!await _file.exists() && await backup.exists()) {
          await backup.rename(_file.path);
        }
        rethrow;
      }
      if (await backup.exists()) await backup.delete();
    });
    _flushQueue = next;
    return next;
  }
}
