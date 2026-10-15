import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// Durable local state used by the native app. It is independent from the web
/// application and is safe to use while completely offline.
class LocalStore {
  LocalStore._(this._directory, this._file);

  final Directory _directory;
  File _file;
  String? _activeUserId;
  Map<String, dynamic> _data = <String, dynamic>{};
  Future<void> _flushQueue = Future<void>.value();
  Future<void> _accountSwitchQueue = Future<void>.value();
  bool _switchingAccount = false;

  /// Null means local guest state. Signed-in users always get a separate file;
  /// legacy global data stays in the guest file and is never uploaded to a
  /// newly signed-in account implicitly.
  String? get activeUserId => _activeUserId;

  static Future<LocalStore> open({Directory? directory}) async {
    final root = directory ?? await getApplicationSupportDirectory();
    final file = File(p.join(root.path, 'pace_local.json'));
    final store = LocalStore._(root, file);
    await store._loadFile(file);
    return store;
  }

  Future<void> activateAccount(String? userId) {
    final nextUserId = userId?.trim().isEmpty == true ? null : userId?.trim();
    final operation = _accountSwitchQueue.catchError((Object _) {}).then((_) async {
      if (_activeUserId == nextUserId) return;

      final previousFile = _file;
      final previousData = _data;
      _switchingAccount = true;
      try {
        await _flush();
        final filename = nextUserId == null
            ? 'pace_local.json'
            : 'pace_local_${nextUserId.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_')}.json';
        final nextFile = File(p.join(_directory.path, filename));
        _file = nextFile;
        _data = <String, dynamic>{};
        try {
          await _loadFile(nextFile);
        } catch (_) {
          _file = previousFile;
          _data = previousData;
          rethrow;
        }
        _activeUserId = nextUserId;
      } finally {
        _switchingAccount = false;
      }
    });
    _accountSwitchQueue = operation;
    return operation;
  }

  Future<void> _loadFile(File file) async {
    final backup = File('${file.path}.bak');
    if (!await file.exists() && await backup.exists()) {
      await backup.rename(file.path);
    }
    if (!await file.exists()) {
      _data = <String, dynamic>{};
      return;
    }

    try {
      final decoded = jsonDecode(await file.readAsString());
      if (decoded is! Map<String, dynamic>) {
        throw const FormatException('Local state root must be a JSON object');
      }
      _data = decoded;
    } catch (_) {
      // Preserve corrupt state for recovery instead of silently replacing it
      // with an empty store. If the last known-good backup exists, restore it.
      final quarantine = File('${file.path}.corrupt-${DateTime.now().toUtc().microsecondsSinceEpoch}');
      await file.rename(quarantine.path);
      if (await backup.exists()) {
        try {
          final backupDecoded = jsonDecode(await backup.readAsString());
          if (backupDecoded is! Map<String, dynamic>) {
            throw const FormatException('Local state backup root must be a JSON object');
          }
          _data = backupDecoded;
          await backup.copy(file.path);
          return;
        } catch (_) {
          // Keep the backup untouched for manual recovery if it is also invalid.
        }
      }
      _data = <String, dynamic>{};
    }
  }

  dynamic read(String key) => _data[key];

  String? lastSyncedAt(String key) => _syncMeta[key] as String?;

  Future<void> write(String key, dynamic value, {bool enqueueSync = true}) async {
    if (_switchingAccount) throw StateError('Local account is switching');
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
    if (_switchingAccount) throw StateError('Local account is switching');
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

  Future<void> applyRemote(
    String key,
    dynamic value,
    String updatedAt, {
    required String expectedUserId,
  }) async {
    if (_switchingAccount || _activeUserId != expectedUserId) {
      throw StateError('Local account changed before remote apply');
    }
    _data[key] = value;
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

  List<Map<String, dynamic>> pendingOperations({DateTime? now}) {
    final current = (now ?? DateTime.now().toUtc()).toUtc();
    final due = _outbox.where((entry) {
      final rawNextAttempt = entry['nextAttemptAt'];
      if (rawNextAttempt is! String) return true;
      final nextAttempt = DateTime.tryParse(rawNextAttempt);
      return nextAttempt == null || !nextAttempt.isAfter(current);
    }).map((entry) => Map<String, dynamic>.unmodifiable(entry)).toList();
    return List.unmodifiable(due);
  }

  Future<void> deferOperation(
    Map<String, dynamic> operation, {
    required String expectedUserId,
    DateTime? now,
  }) async {
    if (_switchingAccount || _activeUserId != expectedUserId) {
      throw StateError('Local account changed before retry scheduling');
    }
    final outbox = _outbox;
    final queuedAt = operation['queuedAt'];
    final index = outbox.indexWhere((entry) {
      if (entry['key'] != operation['key']) return false;
      if (queuedAt != null) return entry['queuedAt'] == queuedAt;
      return entry['operation'] == operation['operation'] && entry['value'] == operation['value'];
    });
    if (index < 0) return;

    final entry = outbox[index];
    final attempts = (entry['attempts'] as num?)?.toInt() ?? 0;
    final exponent = attempts.clamp(0, 8);
    final delaySeconds = (5 * (1 << exponent)).clamp(5, 900).toInt();
    final current = (now ?? DateTime.now().toUtc()).toUtc();
    entry['attempts'] = attempts + 1;
    entry['nextAttemptAt'] = current.add(Duration(seconds: delaySeconds)).toIso8601String();
    _data['__outbox'] = outbox;
    await _flush();
  }

  Future<void> acknowledgeOperation(
    Map<String, dynamic> operation, {
    required String expectedUserId,
  }) async {
    if (_switchingAccount || _activeUserId != expectedUserId) {
      throw StateError('Local account changed before outbox acknowledgement');
    }
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

  Future<void> _flush() {
    // Capture both the destination and snapshot now: an account switch must
    // never redirect a queued write into the next account's file.
    final targetFile = _file;
    final serialized = jsonEncode(_data);
    _flushQueue = _flushQueue.catchError((Object _) {}).then((_) async {
      await targetFile.parent.create(recursive: true);
      final temporary = File('${targetFile.path}.tmp');
      final backup = File('${targetFile.path}.bak');
      await temporary.writeAsString(serialized, flush: true);

      if (await targetFile.exists()) {
        if (await backup.exists()) await backup.delete();
        await targetFile.rename(backup.path);
      }
      try {
        await temporary.rename(targetFile.path);
        if (await backup.exists()) await backup.delete();
      } catch (_) {
        if (!await targetFile.exists() && await backup.exists()) {
          await backup.rename(targetFile.path);
        }
        rethrow;
      }
    });
    return _flushQueue;
  }
}
