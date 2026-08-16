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
  Future<void> _flushQueue = Future<void>.value();

  static Future<LocalStore> open() async {
    final directory = await getApplicationSupportDirectory();
    final file = File(p.join(directory.path, 'pace_local.json'));
    final store = LocalStore._(file);
    if (await file.exists()) {
      try {
        final decoded = jsonDecode(await file.readAsString());
        if (decoded is Map<String, dynamic>) store._data = decoded;
      } catch (_) {
        store._data = <String, dynamic>{};
      }
    }
    return store;
  }

  dynamic read(String key) => _data[key];

  String? lastSyncedAt(String key) => _syncMeta[key] as String?;

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

  Future<void> _flush() {
    // Network sync can overlap with a user write. Serializing filesystem
    // replacement prevents an older flush from racing a newer one.
    _flushQueue = _flushQueue.then((_) async {
      await _file.parent.create(recursive: true);
      final temporary = File('${_file.path}.tmp');
      await temporary.writeAsString(jsonEncode(_data), flush: true);
      if (await _file.exists()) await _file.delete();
      await temporary.rename(_file.path);
    });
    return _flushQueue;
  }
}
