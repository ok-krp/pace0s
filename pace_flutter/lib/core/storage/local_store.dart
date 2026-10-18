import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// Durable local state used by the native app. It is independent from the web
/// application and is safe to use while completely offline.
class LocalStore extends ChangeNotifier {
  LocalStore._(this._directory, this._file);

  final Directory _directory;
  File _file;
  String? _activeUserId;
  Map<String, dynamic> _data = <String, dynamic>{};
  Future<void> _flushQueue = Future<void>.value();
  Future<void> _accountSwitchQueue = Future<void>.value();
  int _pendingAccountSwitches = 0;
  int _outboxRepairRevision = 0;
  int _persistedOutboxRepairRevision = 0;

  bool get _switchingAccount => _pendingAccountSwitches > 0;

  /// Produces a per-key monotonic timestamp for server-side newest-wins writes.
  /// DateTime.now() can repeat within one microsecond or move backwards after
  /// a system-clock adjustment; either case must not create an equal/older write.
  static DateTime monotonicQueuedAt({
    required DateTime now,
    required DateTime? latestKnownAt,
  }) {
    final current = now.toUtc();
    final latest = latestKnownAt?.toUtc();
    if (latest != null && !current.isAfter(latest)) {
      return latest.add(const Duration(microseconds: 1));
    }
    return current;
  }

  /// Validate the durable outbox envelope before replay or replacement.
  static bool isValidOutboxOperation(Map<String, dynamic> operation) {
    final key = operation['key'];
    final queuedAt = operation['queuedAt'];
    final kind = operation['operation'];
    if (key is! String || key.isEmpty || queuedAt is! String) return false;
    if (!isValidIsoTimestamp(queuedAt)) return false;
    if (kind == 'upsert') return operation.containsKey('value');
    return kind == 'delete';
  }

  /// Validates timestamps used by local metadata and the Supabase sync API.
  /// DateTime.parse normalizes some overflowing components (for example, an
  /// invalid day can roll into the next month), so those values must be rejected
  /// rather than silently reinterpreted as a different instant.
  static bool isValidIsoTimestamp(String value) {
    final match = RegExp(
      r'^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))?$',
    ).firstMatch(value);
    if (match == null || DateTime.tryParse(value) == null) return false;

    final year = int.parse(match.group(1)!);
    // PostgreSQL/ISO calendar timestamps have no year zero.
    if (year < 1) return false;
    final month = int.parse(match.group(2)!);
    final day = int.parse(match.group(3)!);
    final hour = int.parse(match.group(4)!);
    final minute = int.parse(match.group(5)!);
    final second = int.parse(match.group(6)!);
    final normalized = DateTime.utc(year, month, day, hour, minute, second);
    if (normalized.year != year ||
        normalized.month != month ||
        normalized.day != day ||
        normalized.hour != hour ||
        normalized.minute != minute ||
        normalized.second != second) {
      return false;
    }

    // The regex allows an optional timezone for legacy local timestamps. If
    // an offset is present, its numeric fields still need valid ranges.
    if (match.group(8) != null && match.group(8) != 'Z') {
      final offsetHours = int.parse(match.group(10)!);
      final offsetMinutes = int.parse(match.group(11)!);
      if (offsetHours > 14 ||
          offsetMinutes > 59 ||
          (offsetHours == 14 && offsetMinutes != 0)) {
        return false;
      }
    }
    return true;
  }

  String _nextQueuedAt(String key, List<Map<String, dynamic>> outbox) {
    final syncedAt = lastSyncedAt(key);
    DateTime? latest = syncedAt != null && isValidIsoTimestamp(syncedAt)
        ? DateTime.tryParse(syncedAt)?.toUtc()
        : null;
    for (final entry in outbox) {
      if (entry['key'] != key || entry['queuedAt'] is! String) continue;
      final rawQueuedAt = entry['queuedAt'] as String;
      if (!isValidIsoTimestamp(rawQueuedAt)) continue;
      final queuedAt = DateTime.tryParse(rawQueuedAt)?.toUtc();
      if (queuedAt != null && (latest == null || queuedAt.isAfter(latest))) {
        latest = queuedAt;
      }
    }
    return monotonicQueuedAt(
      now: DateTime.now().toUtc(),
      latestKnownAt: latest,
    ).toIso8601String();
  }

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
    // Close the write/apply gate synchronously when the switch is requested,
    // not later when its queued file operation begins. Otherwise a UI callback
    // can persist one last mutation into the account being signed out.
    _pendingAccountSwitches++;
    final operation = _accountSwitchQueue
        .catchError((Object _) {})
        .then((_) async {
          try {
            if (_activeUserId == nextUserId) return;

            final previousFile = _file;
            final previousData = _data;
            await _flush();
            final filename = nextUserId == null
                ? 'pace_local.json'
                : _accountFileName(nextUserId);
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
            notifyListeners();
          } finally {
            _pendingAccountSwitches--;
          }
        });
    _accountSwitchQueue = operation;
    return operation;
  }

  /// Keep account files distinct even if unusual auth IDs normalize to the
  /// same filesystem-safe characters (for example, `user/a` and `user_a`).
  /// Ordinary UUID-like IDs retain the existing filename for compatibility.
  static String _accountFileName(String userId) {
    final safeUserId = userId.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
    final encodedUserId = base64Url.encode(utf8.encode(userId)).replaceAll('=', '');
    // Keep ordinary UUID-like IDs compatible with existing account files.
    if (safeUserId == userId && !_isAmbiguousLegacyEscapedId(userId)) {
      return 'pace_local_$safeUserId.json';
    }

    // The separator is deliberately outside the safe-ID alphabet. Appending
    // base64 to an underscore-only name is not injective: an escaped ID such
    // as "user/a" could collide with the literal ID "user_a__dXNlci9h".
    // Also escape literal IDs that resemble the old suffix, so neither side
    // can continue reading an ambiguous legacy file after this fix.
    return 'pace_local_$safeUserId~$encodedUserId.json';
  }

  static bool _isAmbiguousLegacyEscapedId(String userId) {
    final match = RegExp(r'^([A-Za-z0-9_-]+)__([A-Za-z0-9_-]+)$')
        .firstMatch(userId);
    if (match == null) return false;
    try {
      final decoded = utf8.decode(
        base64Url.decode(base64Url.normalize(match.group(2)!)),
      );
      final decodedSafeId = decoded.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
      return decoded != userId && decodedSafeId == match.group(1);
    } on FormatException {
      return false;
    }
  }

  Future<void> _loadFile(File file) async {
    final backup = File('${file.path}.bak');
    if (!await file.exists() && await backup.exists()) {
      await backup.copy(file.path);
    }
    if (!await file.exists()) {
      _data = <String, dynamic>{};
      return;
    }

    // Read errors are not evidence of corrupt JSON. Let I/O/permission failures
    // propagate without renaming a potentially valid primary file.
    final contents = await file.readAsString();
    try {
      final decoded = jsonDecode(contents);
      if (decoded is! Map<String, dynamic>) {
        throw const FormatException('Local state root must be a JSON object');
      }
      _data = decoded;
    } on FormatException {
      // Preserve corrupt state for recovery instead of silently replacing it
      // with an empty store. If the last known-good backup exists, restore it.
      final quarantine = File('${file.path}.corrupt-${DateTime.now().toUtc().microsecondsSinceEpoch}');
      await file.rename(quarantine.path);
      if (await backup.exists()) {
        final backupContents = await backup.readAsString();
        dynamic backupDecoded;
        try {
          backupDecoded = jsonDecode(backupContents);
          if (backupDecoded is! Map<String, dynamic>) {
            throw const FormatException('Local state backup root must be a JSON object');
          }
        } on FormatException {
          // Keep the backup untouched for manual recovery if it is also invalid.
          backupDecoded = null;
        }
        if (backupDecoded is Map<String, dynamic>) {
          await backup.copy(file.path);
          _data = backupDecoded;
          return;
        }
      }
      _data = <String, dynamic>{};
    }
  }

  dynamic read(String key) => _data[key];

  String? lastSyncedAt(String key) {
    final value = _syncMeta[key];
    return value is String ? value : null;
  }

  /// Persist a UI-originated mutation only if it still belongs to the account
  /// that created the operation. This prevents delayed async callbacks from a
  /// disposed page writing account A's data into account B's local file.
  Future<void> writeForAccount(
    String? expectedUserId,
    String key,
    dynamic value, {
    bool enqueueSync = true,
    bool notify = true,
  }) async {
    if (_switchingAccount || _activeUserId != expectedUserId) return;
    try {
      await write(key, value, enqueueSync: enqueueSync, notify: notify);
    } on StateError {
      // A switch can be requested after the initial scope check but before
      // [write] starts. Treat that as a stale callback, not an app-level error.
      if (_switchingAccount || _activeUserId != expectedUserId) return;
      rethrow;
    }
  }

  Future<void> removeForAccount(
    String? expectedUserId,
    String key, {
    bool enqueueSync = true,
    bool notify = true,
  }) async {
    if (_switchingAccount || _activeUserId != expectedUserId) return;
    try {
      await remove(key, enqueueSync: enqueueSync, notify: notify);
    } on StateError {
      if (_switchingAccount || _activeUserId != expectedUserId) return;
      rethrow;
    }
  }

  Future<void> write(
    String key,
    dynamic value, {
    bool enqueueSync = true,
    bool notify = true,
  }) async {
    if (_switchingAccount) throw StateError('Local account is switching');
    _data[key] = value;
    if (enqueueSync) {
      final outbox = _outbox;
      final queuedAt = _nextQueuedAt(key, outbox);
      _quarantineMalformedReplacedOperations(outbox, key);
      outbox.removeWhere((entry) => entry['key'] == key);
      outbox.add({
        'key': key,
        'value': value,
        'operation': 'upsert',
        'queuedAt': queuedAt,
      });
      _data['__outbox'] = outbox;
    }
    await _flush();
    if (notify) notifyListeners();
  }

  Future<void> remove(
    String key, {
    bool enqueueSync = true,
    bool notify = true,
  }) async {
    if (_switchingAccount) throw StateError('Local account is switching');
    _data.remove(key);
    if (enqueueSync) {
      final outbox = _outbox;
      final queuedAt = _nextQueuedAt(key, outbox);
      _quarantineMalformedReplacedOperations(outbox, key);
      outbox.removeWhere((entry) => entry['key'] == key);
      outbox.add({
        'key': key,
        'operation': 'delete',
        'queuedAt': queuedAt,
      });
      _data['__outbox'] = outbox;
    }
    await _flush();
    if (notify) notifyListeners();
  }

  Future<void> applyRemote(
    String key,
    dynamic value,
    String updatedAt, {
    required String expectedUserId,
    bool notify = true,
  }) async {
    if (_switchingAccount || _activeUserId != expectedUserId) {
      throw StateError('Local account changed before remote apply');
    }
    if (!isValidIsoTimestamp(updatedAt)) {
      throw FormatException('Remote updated_at must be a valid ISO timestamp');
    }
    _data[key] = value;
    _setSyncedAt(key, updatedAt);
    await _flush();
    if (notify) notifyListeners();
  }

  /// Public notification hook for batched remote pulls after silent row writes.
  void notifyStateChanged() => notifyListeners();

  Map<String, String> syncedMetadata() => {
        for (final entry in _syncMeta.entries)
          if (entry.value is String) entry.key: entry.value as String,
      };

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

  void _quarantineMalformedReplacedOperations(
    List<Map<String, dynamic>> outbox,
    String key,
  ) {
    final malformed = outbox
        .where((entry) =>
            entry['key'] == key && !LocalStore.isValidOutboxOperation(entry))
        .toList();
    for (final entry in malformed) {
      _appendQuarantineEntry('malformed-outbox-operation-replaced', entry);
    }
  }

  void _appendQuarantineEntry(String reason, dynamic payload) {
    _outboxRepairRevision++;
    final rawQuarantine = _data['__outbox_quarantine'];
    final quarantine = rawQuarantine is List
        ? List<dynamic>.from(rawQuarantine)
        : <dynamic>[];
    if (rawQuarantine != null && rawQuarantine is! List) {
      quarantine.add({
        'reason': 'malformed-quarantine-container',
        'quarantinedAt': DateTime.now().toUtc().toIso8601String(),
        'operation': rawQuarantine,
      });
    }
    quarantine.add({
      'reason': reason,
      'quarantinedAt': DateTime.now().toUtc().toIso8601String(),
      'operation': payload,
    });
    _data['__outbox_quarantine'] = quarantine;
  }

  List<Map<String, dynamic>> get _outbox {
    // A valid JSON document can still contain malformed reserved fields or
    // entries. Preserve the raw payload in quarantine instead of silently
    // dropping it when a later mutation repairs the queue.
    final raw = _data['__outbox'];
    if (raw is! List) {
      if (raw != null) {
        _appendQuarantineEntry('malformed-outbox-container', raw);
        _data['__outbox'] = <dynamic>[];
      }
      return <Map<String, dynamic>>[];
    }

    final valid = <Map<String, dynamic>>[];
    for (final entry in raw) {
      if (entry is! Map) {
        _appendQuarantineEntry('malformed-outbox-entry', entry);
        continue;
      }
      try {
        valid.add(Map<String, dynamic>.from(entry));
      } on TypeError {
        _appendQuarantineEntry('malformed-outbox-entry', entry);
      }
    }
    if (valid.length != raw.length) {
      _data['__outbox'] = valid;
      // The getter is synchronous, so persist this repair explicitly from the
      // sync worker before it returns early on an empty queue.
      _outboxRepairRevision++;
    }
    return valid;
  }

  /// Flushes any quarantine/normalization performed by the synchronous
  /// outbox reader. Without this, malformed entries could be quarantined only
  /// in memory and reappear after process restart when no valid work remains.
  Future<void> persistOutboxRepairs({required String expectedUserId}) async {
    if (_persistedOutboxRepairRevision == _outboxRepairRevision) return;
    if (_switchingAccount || _activeUserId != expectedUserId) {
      throw StateError('Local account changed before outbox repair persistence');
    }
    final revision = _outboxRepairRevision;
    await _flush();
    if (revision == _outboxRepairRevision) {
      _persistedOutboxRepairRevision = revision;
    }
  }

  List<Map<String, dynamic>> pendingOperations({DateTime? now}) {
    final current = (now ?? DateTime.now().toUtc()).toUtc();
    final due = _outbox.where((entry) {
      final rawNextAttempt = entry['nextAttemptAt'];
      if (rawNextAttempt is! String) return true;
      final nextAttempt = rawNextAttempt is String &&
              isValidIsoTimestamp(rawNextAttempt)
          ? DateTime.tryParse(rawNextAttempt)
          : null;
      return nextAttempt == null || !nextAttempt.isAfter(current);
    }).map((entry) => Map<String, dynamic>.unmodifiable(entry)).toList();
    return List.unmodifiable(due);
  }

  /// Moves an un-replayable outbox entry to a local quarantine instead of
  /// retrying it forever or silently deleting its payload.
  Future<void> quarantineOperation(
    Map<String, dynamic> operation, {
    required String expectedUserId,
    required String reason,
  }) async {
    if (_switchingAccount || _activeUserId != expectedUserId) {
      throw StateError('Local account changed before outbox quarantine');
    }
    final rawOutbox = _data['__outbox'];
    if (rawOutbox is! List) return;
    final serializedOperation = jsonEncode(operation);
    final index = rawOutbox.indexWhere((entry) {
      if (entry is! Map) return false;
      try {
        return jsonEncode(Map<String, dynamic>.from(entry)) == serializedOperation;
      } on TypeError {
        return false;
      }
    });
    if (index < 0) return;

    final rawQuarantine = _data['__outbox_quarantine'];
    final quarantine = rawQuarantine is List
        ? List<dynamic>.from(rawQuarantine)
        : <dynamic>[];
    if (rawQuarantine != null && rawQuarantine is! List) {
      // Preserve an invalid quarantine container too; recovery code must not
      // replace one malformed field by silently losing another payload.
      quarantine.add({
        'reason': 'malformed-quarantine-container',
        'quarantinedAt': DateTime.now().toUtc().toIso8601String(),
        'operation': rawQuarantine,
      });
    }
    final entry = rawOutbox.removeAt(index);
    quarantine.add({
      'reason': reason,
      'quarantinedAt': DateTime.now().toUtc().toIso8601String(),
      'operation': entry,
    });
    _data['__outbox'] = rawOutbox;
    _data['__outbox_quarantine'] = quarantine;
    await _flush();
  }

  /// True while an outbox mutation exists, including mutations deferred by
  /// retry backoff. Pulls must not overwrite local values just because a
  /// queued mutation is temporarily not due for replay.
  bool hasPendingOperationForKey(String key) =>
      _outbox.any((entry) => entry['key'] == key);

  /// Whether [operation] is still the current queued mutation for its key.
  /// Network requests can finish after a newer local edit replaces the outbox
  /// entry; conflict handling must not apply the server row over that edit.
  bool isPendingOperation(Map<String, dynamic> operation) =>
      _outbox.any((entry) {
        if (entry['key'] != operation['key']) return false;
        final queuedAt = operation['queuedAt'];
        if (entry['queuedAt'] != queuedAt) return false;
        return entry['operation'] == operation['operation'] &&
            entry['value'] == operation['value'];
      });

  /// True only when this key's queued mutation is eligible for replay now.
  /// This is separate from [hasPendingOperationForKey], which also protects
  /// deferred local edits from being overwritten by remote pulls.
  bool hasDueOperationForKey(String key, {DateTime? now}) {
    final current = (now ?? DateTime.now().toUtc()).toUtc();
    return _outbox.any((entry) {
      if (entry['key'] != key) return false;
      final rawNextAttempt = entry['nextAttemptAt'];
      if (rawNextAttempt is! String) return true;
      final nextAttempt = isValidIsoTimestamp(rawNextAttempt)
          ? DateTime.tryParse(rawNextAttempt)
          : null;
      return nextAttempt == null || !nextAttempt.isAfter(current);
    });
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
      if (entry['queuedAt'] != queuedAt) return false;
      // queuedAt is a timestamp, not a unique operation ID. Match the payload
      // as well so a stale in-flight response cannot defer a replacement write
      // if two mutations happen to receive the same timestamp.
      return entry['operation'] == operation['operation'] &&
          entry['value'] == operation['value'];
    });
    if (index < 0) return;

    final entry = outbox[index];
    final rawAttempts = entry['attempts'];
    // A readable local JSON file can still contain stale or manually edited
    // retry metadata. Normalize it instead of letting a String/bool overflow
    // the cast and abort sync retry scheduling.
    final attempts = rawAttempts is num && rawAttempts.isFinite && rawAttempts >= 0
        ? rawAttempts.toInt().clamp(0, 8).toInt()
        : 0;
    final delaySeconds = (5 * (1 << attempts)).clamp(5, 900).toInt();
    final current = (now ?? DateTime.now().toUtc()).toUtc();
    entry['attempts'] = attempts + 1;
    entry['nextAttemptAt'] = current.add(Duration(seconds: delaySeconds)).toIso8601String();
    _data['__outbox'] = outbox;
    await _flush();
  }

  Future<void> acknowledgeOperation(
    Map<String, dynamic> operation, {
    required String expectedUserId,
    String? syncedAt,
  }) async {
    if (_switchingAccount || _activeUserId != expectedUserId) {
      throw StateError('Local account changed before outbox acknowledgement');
    }
    final outbox = _outbox;
    final queuedAt = operation['queuedAt'];
    outbox.removeWhere((entry) {
      if (entry['key'] != operation['key']) return false;
      if (entry['queuedAt'] != queuedAt) return false;
      // Never acknowledge a newer payload solely because its timestamp
      // collides with the operation whose network request just completed.
      return entry['operation'] == operation['operation'] &&
          entry['value'] == operation['value'];
    });
    if (syncedAt != null) {
      final key = operation['key'] as String;
      final acceptedAt = isValidIsoTimestamp(syncedAt)
          ? DateTime.tryParse(syncedAt)?.toUtc()
          : null;
      if (acceptedAt != null) {
        final previousRawTimestamp = lastSyncedAt(key);
        final previouslySyncedAt = previousRawTimestamp != null &&
                isValidIsoTimestamp(previousRawTimestamp)
            ? DateTime.tryParse(previousRawTimestamp)?.toUtc()
            : null;
        final latestKnownAt = previouslySyncedAt != null &&
                previouslySyncedAt.isAfter(acceptedAt)
            ? previouslySyncedAt
            : acceptedAt;

        // Out-of-order completions must never move the local version cursor
        // backward. A stale acknowledgement may arrive after a newer pull or
        // another sync worker has already recorded a later server version.
        if (previouslySyncedAt == null ||
            !previouslySyncedAt.isAfter(acceptedAt)) {
          _setSyncedAt(key, syncedAt);
        }

        // A newer local edit may have been queued while this operation was
        // in flight. Rebase it against the newest known server version so the
        // next push cannot be rejected as older and then overwrite the edit.
        for (final entry in outbox) {
          if (entry['key'] != key || entry['queuedAt'] is! String) continue;
          final rawQueuedAt = entry['queuedAt'] as String;
          final queuedAt = isValidIsoTimestamp(rawQueuedAt)
              ? DateTime.tryParse(rawQueuedAt)?.toUtc()
              : null;
          if (queuedAt == null || !queuedAt.isAfter(latestKnownAt)) {
            entry['queuedAt'] = monotonicQueuedAt(
              now: DateTime.now().toUtc(),
              latestKnownAt: latestKnownAt,
            ).toIso8601String();
          }
        }
      }
    }
    _data['__outbox'] = outbox;
    await _flush();
  }

  Future<void> _flush() {
    // Capture both the destination and snapshot now: an account switch must
    // never redirect a queued write into the next account's file.
    final targetFile = _file;
    final serialized = jsonEncode(_data);
    final repairRevision = _outboxRepairRevision;
    _flushQueue = _flushQueue.catchError((Object _) {}).then((_) async {
      await targetFile.parent.create(recursive: true);
      final temporary = File('${targetFile.path}.tmp');
      final backup = File('${targetFile.path}.bak');
      await temporary.writeAsString(serialized, flush: true);

      if (await targetFile.exists()) {
        // Keep the previous complete snapshot as a durable recovery point.
        // Copy first; the primary remains intact if backup creation fails.
        await targetFile.copy(backup.path);
        await targetFile.delete();
      }
      try {
        await temporary.rename(targetFile.path);
        // Mark synchronous outbox repairs durable only if this exact snapshot
        // included the latest repair revision. A concurrent repair must force
        // another flush rather than being mistaken for persisted data.
        if (repairRevision == _outboxRepairRevision) {
          _persistedOutboxRepairRevision = repairRevision;
        }
        // Intentionally retain .bak as the last known-good snapshot. The next
        // successful flush replaces it with the current primary file.
      } catch (_) {
        if (!await targetFile.exists() && await backup.exists()) {
          await backup.copy(targetFile.path);
        }
        rethrow;
      }
    });
    return _flushQueue;
  }
}