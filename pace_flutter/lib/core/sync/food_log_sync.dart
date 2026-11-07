import 'dart:collection';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../storage/local_store.dart';

/// Account-scoped, durable synchronization for the relational food_log table.
///
/// Nutrition JSON remains a local presentation cache. New authenticated
/// mutations are written to this outbox and never mirrored into user_state.
class FoodLogSync {
  static const String outboxKey = 'pace.__sync_food_log_outbox';
  static const String quarantineKey = 'pace.__sync_food_log_quarantine';
  static const String cursorKey = 'pace.__sync_food_log_cursor';
  static const String deletedIdsKey = 'pace.nutrition.deleted_ids';
  static const Duration cursorOverlap = Duration(minutes: 5);
  static const Duration fullReconciliationInterval = Duration(hours: 24);
  static const Duration tombstoneRetention = Duration(days: 90);
  static const int maximumTombstones = 500;
  static const int maximumPendingOperations = 2000;

  static const String _select =
      'id,log_date,meal,name,kcal,protein_g,carbs_g,fat_g,fiber_g,sugar_g,sodium_mg,source,meta,created_at';

  static bool isUuid(String value) {
    if (value.length != 36) return false;
    const hyphenPositions = <int>{8, 13, 18, 23};
    for (var index = 0; index < value.length; index++) {
      final code = value.codeUnitAt(index);
      if (hyphenPositions.contains(index)) {
        if (code != 45) return false;
      } else {
        final isDigit = code >= 48 && code <= 57;
        final isLowerHex = code >= 97 && code <= 102;
        final isUpperHex = code >= 65 && code <= 70;
        if (!isDigit && !isLowerHex && !isUpperHex) return false;
      }
    }
    final version = int.parse(value.substring(14, 15), radix: 16);
    final variant = int.parse(value.substring(19, 20), radix: 16);
    return version >= 1 && version <= 8 && variant >= 8 && variant <= 11;
  }

  /// Normalize the relational row into the map consumed by NutritionPage.
  /// Optional micronutrients live in food_log.meta and must survive refreshes.
  static Map<String, dynamic> mapFoodLogRowToNutritionItem(
    Map<String, dynamic> row,
  ) {
    final meta = row['meta'];
    final missing = meta is Map && meta['missing_nutrients'] is List
        ? (meta['missing_nutrients'] as List).whereType<String>().toSet()
        : <String>{};

    num? optionalMetaNumber(String key) {
      final value = meta is Map ? meta[key] : null;
      return value is num && value.isFinite ? value : null;
    }

    return <String, dynamic>{
      'id': row['id'],
      'name': row['name'],
      'meal': row['meal'],
      'qty': 1,
      'kcal': missing.contains('kcal') ? null : row['kcal'],
      'p': missing.contains('protein_g') ? null : row['protein_g'],
      'c': missing.contains('carbs_g') ? null : row['carbs_g'],
      'f': missing.contains('fat_g') ? null : row['fat_g'],
      'sat': optionalMetaNumber('sat_fat_g'),
      'salt': optionalMetaNumber('salt_g'),
      'fiber': missing.contains('fiber_g') ? null : row['fiber_g'],
      'sugar': missing.contains('sugar_g') ? null : row['sugar_g'],
      'sodium': missing.contains('sodium_mg') ? null : row['sodium_mg'],
      'iron': optionalMetaNumber('iron_mg'),
      'calcium': optionalMetaNumber('calcium_mg'),
      'vitC': optionalMetaNumber('vitamin_c_mg'),
      'created_at': row['created_at'],
      '__foodLogCanonical': true,
    };
  }

  static Map<String, dynamic>? parseFoodLogCursor(
    dynamic raw, {
    required String logDate,
  }) {
    if (raw is! Map) return null;
    final cursor = Map<String, dynamic>.from(raw);
    final createdAt = cursor['createdAt'];
    final id = cursor['id'];
    final lastFullAt = cursor['lastFullAt'];
    if (cursor['logDate'] != logDate ||
        createdAt is! String ||
        !LocalStore.isValidRemoteTimestamp(createdAt) ||
        (id != null && (id is! String || !isUuid(id))) ||
        lastFullAt is! String ||
        !LocalStore.isValidRemoteTimestamp(lastFullAt)) {
      return null;
    }
    return <String, dynamic>{
      'logDate': logDate,
      'createdAt': createdAt,
      'id': id,
      'lastFullAt': lastFullAt,
    };
  }

  static bool shouldRunFullFoodLogReconciliation({
    required Map<String, dynamic>? cursor,
    required String logDate,
    DateTime? now,
  }) {
    final current = (now ?? DateTime.now()).toUtc();
    if (cursor == null || cursor['logDate'] != logDate) return true;
    final rawLastFull = cursor['lastFullAt'];
    if (rawLastFull is! String || !LocalStore.isValidRemoteTimestamp(rawLastFull)) {
      return true;
    }
    final lastFullAt = DateTime.tryParse(rawLastFull)?.toUtc();
    return lastFullAt == null ||
        lastFullAt.isAfter(current) ||
        current.difference(lastFullAt) >= fullReconciliationInterval;
  }

  static String foodLogDeltaSince(Map<String, dynamic> cursor) {
    final raw = cursor['createdAt'];
    if (raw is! String || !LocalStore.isValidRemoteTimestamp(raw)) {
      throw ArgumentError.value(raw, 'cursor.createdAt');
    }
    return DateTime.parse(raw).toUtc().subtract(cursorOverlap).toIso8601String();
  }

  static Map<String, dynamic> nextFoodLogCursor({
    required Map<String, dynamic>? previous,
    required List<Map<String, dynamic>> rows,
    required String logDate,
    required bool fullReconciliation,
    DateTime? now,
  }) {
    final current = (now ?? DateTime.now()).toUtc();
    // The persisted cursor is a successful-scan watermark, not a row cursor.
    // The next delta starts five minutes earlier; tuple cursors are used only
    // inside each paginated request to catch late commits without full-day scans.
    for (final row in rows) {
      final createdAt = row['created_at'];
      final id = row['id'];
      if (createdAt is! String ||
          !LocalStore.isValidRemoteTimestamp(createdAt) ||
          id is! String ||
          !isUuid(id)) {
        throw const FormatException('Invalid food_log row while advancing cursor');
      }
    }
    final watermark = current.toIso8601String();
    return <String, dynamic>{
      'logDate': logDate,
      'createdAt': watermark,
      'id': null,
      'lastFullAt': fullReconciliation
          ? watermark
          : previous?['lastFullAt'] ?? DateTime.fromMillisecondsSinceEpoch(0, isUtc: true).toIso8601String(),
    };
  }

  static int? _compareFoodLogTuple(
    Map<String, dynamic> left,
    Map<String, dynamic> right,
  ) {
    final leftRaw = left['created_at'];
    final rightRaw = right['created_at'];
    final leftId = left['id'];
    final rightId = right['id'];
    if (leftRaw is! String ||
        rightRaw is! String ||
        leftId is! String ||
        rightId is! String) {
      return null;
    }
    final leftTime = DateTime.tryParse(leftRaw)?.toUtc();
    final rightTime = DateTime.tryParse(rightRaw)?.toUtc();
    if (leftTime == null || rightTime == null) return null;
    final byTime = leftTime.microsecondsSinceEpoch.compareTo(rightTime.microsecondsSinceEpoch);
    return byTime != 0 ? byTime : leftId.compareTo(rightId);
  }

  static Future<List<Map<String, dynamic>>?> fetchAllTuplePages({
    required Future<List<Map<String, dynamic>>?> Function(
      String? afterCreatedAt,
      String? afterId,
      int pageSize,
    ) fetchPage,
    int pageSize = 500,
    bool Function()? isCancelled,
  }) async {
    if (pageSize < 1) throw ArgumentError.value(pageSize, 'pageSize');
    final cancelled = isCancelled ?? () => false;
    final rows = <Map<String, dynamic>>[];
    String? afterCreatedAt;
    String? afterId;

    while (true) {
      if (cancelled()) return null;
      List<Map<String, dynamic>>? page;
      try {
        page = await fetchPage(afterCreatedAt, afterId, pageSize);
      } catch (_) {
        return null;
      }
      if (cancelled() || page == null || page.length > pageSize) return null;

      Map<String, dynamic>? last = afterCreatedAt == null
          ? null
          : <String, dynamic>{'created_at': afterCreatedAt, 'id': afterId};
      for (final row in page) {
        final id = row['id'];
        final createdAt = row['created_at'];
        if (id is! String ||
            !isUuid(id) ||
            createdAt is! String ||
            !LocalStore.isValidRemoteTimestamp(createdAt)) {
          return null;
        }
        if (last != null) {
          final comparison = _compareFoodLogTuple(last, row);
          if (comparison == null || comparison >= 0) return null;
        }
        last = row;
      }

      rows.addAll(page);
      if (page.length < pageSize) return rows;
      if (last == null) return null;
      afterCreatedAt = last['created_at'] as String;
      afterId = last['id'] as String;
    }
  }

  static List<Map<String, dynamic>> mergeCanonicalDelta({
    required List<Map<String, dynamic>> localItems,
    required List<Map<String, dynamic>> remoteItems,
    Set<String> deletedIds = const <String>{},
  }) {
    final merged = <String, Map<String, dynamic>>{};
    for (final item in localItems) {
      final id = item['id']?.toString() ?? '';
      if (id.isNotEmpty && !deletedIds.contains(id)) merged[id] = item;
    }
    for (final item in remoteItems) {
      final id = item['id']?.toString() ?? '';
      if (id.isEmpty) continue;
      if (deletedIds.contains(id)) {
        merged.remove(id);
      } else {
        merged[id] = item;
      }
    }
    return merged.values.toList(growable: false);
  }

  static bool isCalendarDate(String value) {
    if (value.length != 10 || value.codeUnitAt(4) != 45 || value.codeUnitAt(7) != 45) {
      return false;
    }
    final year = int.tryParse(value.substring(0, 4));
    final month = int.tryParse(value.substring(5, 7));
    final day = int.tryParse(value.substring(8, 10));
    if (year == null || month == null || day == null || year < 1) return false;
    final parsed = DateTime.utc(year, month, day);
    return parsed.year == year && parsed.month == month && parsed.day == day;
  }

  static bool _isJsonSafeValue(
    dynamic value, [
    int depth = 0,
    Set<Object>? ancestors,
  ]) {
    if (depth > 20) return false;
    if (value == null || value is String || value is bool) return true;
    if (value is num) return value.isFinite;
    if (value is! List && value is! Map) return false;

    // JSON cannot represent cycles. Use identity tracking so a cyclic Map or
    // List is rejected without recursion overflow, while repeated non-cyclic
    // references in separate branches remain valid.
    final seen = ancestors ?? HashSet<Object>.identity();
    if (!seen.add(value as Object)) return false;
    try {
      if (value is List) {
        for (final item in value) {
          if (!_isJsonSafeValue(item, depth + 1, seen)) return false;
        }
        return true;
      }
      for (final entry in (value as Map).entries) {
        if (entry.key is! String ||
            !_isJsonSafeValue(entry.value, depth + 1, seen)) {
          return false;
        }
      }
      return true;
    } finally {
      seen.remove(value as Object);
    }
  }

  static const Set<String> _allowedOperationKeys = {
    'id',
    'user_id',
    'operation',
    'queuedAt',
    'row',
    'attempts',
    'nextAttemptAt',
  };

  static const Set<String> _allowedFoodLogRowKeys = {
    'id',
    'user_id',
    'log_date',
    'meal',
    'name',
    'kcal',
    'protein_g',
    'carbs_g',
    'fat_g',
    'fiber_g',
    'sugar_g',
    'sodium_mg',
    'source',
    'health_score',
    'meta',
  };

  static bool isValidOperation(Map<String, dynamic> operation) {
    if (operation.keys.any((key) => !_allowedOperationKeys.contains(key))) {
      return false;
    }
    final id = operation['id'];
    final queuedAt = operation['queuedAt'];
    final kind = operation['operation'];
    if (id is! String ||
        !isUuid(id) ||
        queuedAt is! String ||
        !LocalStore.isValidRemoteTimestamp(queuedAt)) {
      return false;
    }
    final operationUserId = operation['user_id'];
    if (operation.containsKey('user_id') &&
        (operationUserId is! String || !isUuid(operationUserId))) {
      return false;
    }
    final attempts = operation['attempts'];
    if (operation.containsKey('attempts') &&
        (attempts is! int || attempts < 0 || attempts > maximumRetryAttempts)) {
      return false;
    }
    final nextAttemptAt = operation['nextAttemptAt'];
    if (operation.containsKey('nextAttemptAt') &&
        (nextAttemptAt is! String ||
            !LocalStore.isValidRemoteTimestamp(nextAttemptAt))) {
      return false;
    }
    if (kind == 'delete') return !operation.containsKey('row');
    if (kind != 'upsert' || operation['row'] is! Map) return false;

    Map<String, dynamic> row;
    try {
      row = Map<String, dynamic>.from(operation['row'] as Map);
    } on TypeError {
      return false;
    }
    if (row.keys.any((key) => !_allowedFoodLogRowKeys.contains(key)) ||
        row['id'] != id ||
        row['user_id'] is! String ||
        !isUuid(row['user_id'] as String) ||
        (operationUserId != null && row['user_id'] != operationUserId) ||
        row['log_date'] is! String ||
        !isCalendarDate(row['log_date'] as String) ||
        row['meal'] is! String ||
        (row['meal'] as String).trim().isEmpty ||
        row['name'] is! String ||
        (row['name'] as String).trim().isEmpty ||
        !const {'manual', 'barcode', 'photo', 'recipe'}.contains(row['source']) ||
        row['meta'] is! Map ||
        !_isJsonSafeValue(row)) {
      return false;
    }
    final healthScore = row['health_score'];
    if (row.containsKey('health_score') &&
        healthScore != null &&
        !const {'green', 'orange', 'red'}.contains(healthScore)) {
      return false;
    }

    for (final key in const ['kcal', 'protein_g', 'carbs_g', 'fat_g']) {
      final value = row[key];
      if (value is! num || !value.isFinite || value < 0) return false;
    }
    for (final key in const ['fiber_g', 'sugar_g', 'sodium_mg']) {
      final value = row[key];
      if (value != null && (value is! num || !value.isFinite || value < 0)) {
        return false;
      }
    }
    return true;
  }

  /// Replace one row's pending command without removing unrelated commands.
  static List<dynamic> queueOperation(
    dynamic rawOutbox, {
    required String operation,
    required String id,
    required String expectedUserId,
    Map<String, dynamic>? row,
    required DateTime now,
  }) {
    if (!isUuid(id)) throw ArgumentError.value(id, 'id');
    if (!isUuid(expectedUserId)) {
      throw ArgumentError.value(expectedUserId, 'expectedUserId');
    }
    if (operation == 'upsert' && row?['user_id'] != expectedUserId) {
      throw ArgumentError('food_log row account does not match the outbox owner');
    }
    if (operation != 'upsert' && operation != 'delete') {
      throw ArgumentError.value(operation, 'operation');
    }
    if (operation == 'upsert' && row == null) {
      throw ArgumentError('An upsert requires a food_log row');
    }

    // Preserve an unexpected root value as a quarantinable entry instead
    // of silently resetting the user's durable outbox to an empty list.
    final entries = rawOutbox is List
        ? List<dynamic>.from(rawOutbox)
        : rawOutbox == null
            ? <dynamic>[]
            : <dynamic>[rawOutbox];
    bool belongsToExpectedAccount(Map<String, dynamic> candidate) {
      final owner = candidate['user_id'];
      if (owner is String) return owner == expectedUserId;
      if (candidate['operation'] == 'upsert') {
        final rawRow = candidate['row'];
        return rawRow is Map && rawRow['user_id'] == expectedUserId;
      }
      // Older delete commands did not carry an explicit owner; they are
      // retained as part of this account's already-scoped local outbox.
      return true;
    }

    var validOperationCount = 0;
    var hasExistingOperation = false;
    for (final entry in entries) {
      if (entry is! Map) continue;
      try {
        final candidate = Map<String, dynamic>.from(entry);
        if (!isValidOperation(candidate) ||
            !belongsToExpectedAccount(candidate)) {
          continue;
        }
        validOperationCount++;
        if (candidate['id'] == id) hasExistingOperation = true;
      } on TypeError {
        // Retain malformed entries for quarantine; they do not count as
        // actionable operations toward the pending-operation limit.
      }
    }
    if (!hasExistingOperation &&
        validOperationCount >= maximumPendingOperations) {
      throw StateError(
        'La file Nutrition locale a atteint sa limite de '
        '$maximumPendingOperations opérations ; aucune donnée existante '
        'n’a été supprimée.',
      );
    }
    DateTime? previousAt;
    for (final entry in entries) {
      if (entry is! Map || entry['id'] != id || entry['queuedAt'] is! String) {
        continue;
      }
      try {
        final candidate = Map<String, dynamic>.from(entry);
        if (!isValidOperation(candidate) ||
            !belongsToExpectedAccount(candidate)) {
          continue;
        }
      } on TypeError {
        continue;
      }
      final raw = entry['queuedAt'] as String;
      if (!LocalStore.isValidIsoTimestamp(raw)) continue;
      final parsed = DateTime.tryParse(raw)?.toUtc();
      if (parsed != null &&
          (previousAt == null || parsed.isAfter(previousAt))) {
        previousAt = parsed;
      }
    }

    final queuedAt = LocalStore.monotonicQueuedAt(
      now: now,
      latestKnownAt: previousAt,
    ).toIso8601String();
    final replacement = <String, dynamic>{
      'id': id,
      'user_id': expectedUserId,
      'operation': operation,
      'queuedAt': queuedAt,
      if (operation == 'upsert') 'row': Map<String, dynamic>.from(row!),
    };
    if (!isValidOperation(replacement)) {
      throw ArgumentError('Invalid food_log outbox operation');
    }
    // Only replace a fully valid command. A malformed entry may contain
    // recoverable user data even when its ID happens to match this row.
    entries.removeWhere((entry) {
      if (entry is! Map || entry['id'] != id) return false;
      try {
        final candidate = Map<String, dynamic>.from(entry);
        return isValidOperation(candidate) &&
            belongsToExpectedAccount(candidate);
      } on TypeError {
        return false;
      }
    });
    entries.add(replacement);
    return entries;
  }

  /// Treat PostgREST's returned error as a failed write, not as an
  /// acknowledgement. Supabase may return {data, error} without throwing.
  static void throwIfPostgrestWriteFailed(Object? error) {
    if (error != null) {
      throw StateError('food_log write failed');
    }
  }

  static const int maximumRetryAttempts = 10;
  static const Duration maximumRetryDelay = Duration(minutes: 15);

  static bool isOperationDue(
    Map<String, dynamic> operation, {
    DateTime? now,
  }) {
    if (!isValidOperation(operation)) return false;
    final nextAttemptAt = operation['nextAttemptAt'];
    if (nextAttemptAt == null) return true;
    final scheduled = DateTime.tryParse(nextAttemptAt as String)?.toUtc();
    return scheduled != null &&
        !scheduled.isAfter((now ?? DateTime.now()).toUtc());
  }

  /// Defer only the exact command that failed. A replacement for the same
  /// UUID must not inherit the previous command's retry delay.
  static List<dynamic> deferOperation(
    dynamic rawOutbox,
    Map<String, dynamic> failed, {
    DateTime? now,
  }) {
    if (rawOutbox is! List) {
      return rawOutbox == null ? <dynamic>[] : <dynamic>[rawOutbox];
    }
    final currentTime = (now ?? DateTime.now()).toUtc();
    return List<dynamic>.from(rawOutbox).map((entry) {
      if (entry is! Map ||
          entry['id'] != failed['id'] ||
          entry['user_id'] != failed['user_id'] ||
          entry['operation'] != failed['operation'] ||
          entry['queuedAt'] != failed['queuedAt'] ||
          entry['attempts'] != failed['attempts'] ||
          entry['nextAttemptAt'] != failed['nextAttemptAt']) {
        return entry;
      }
      try {
        final candidate = Map<String, dynamic>.from(entry);
        if (!isValidOperation(candidate)) return entry;
        final attempts = ((candidate['attempts'] as int?) ?? 0) + 1;
        final boundedAttempts = attempts > maximumRetryAttempts
            ? maximumRetryAttempts
            : attempts;
        final exponent = boundedAttempts > 5 ? 5 : boundedAttempts;
        final rawDelaySeconds = 30 * (1 << exponent);
        final delaySeconds = rawDelaySeconds > maximumRetryDelay.inSeconds
            ? maximumRetryDelay.inSeconds
            : rawDelaySeconds;
        return <String, dynamic>{
          ...candidate,
          'attempts': boundedAttempts,
          'nextAttemptAt': currentTime
              .add(Duration(seconds: delaySeconds))
              .toIso8601String(),
        };
      } on TypeError {
        return entry;
      }
    }).toList(growable: false);
  }

  /// Remove only the exact command whose request completed. An older in-flight
  /// acknowledgement must not delete a newer command for the same row ID.
  static List<dynamic> removeOperation(
    dynamic rawOutbox,
    Map<String, dynamic> completed,
  ) {
    if (rawOutbox is! List) {
      return rawOutbox == null ? <dynamic>[] : <dynamic>[rawOutbox];
    }
    return List<dynamic>.from(rawOutbox)
      ..removeWhere((entry) {
        if (entry is! Map ||
            entry['id'] != completed['id'] ||
            entry['user_id'] != completed['user_id'] ||
            entry['operation'] != completed['operation'] ||
            entry['queuedAt'] != completed['queuedAt'] ||
            entry['attempts'] != completed['attempts'] ||
            entry['nextAttemptAt'] != completed['nextAttemptAt']) {
          return false;
        }
        try {
          final candidate = Map<String, dynamic>.from(entry);
          return isValidOperation(candidate);
        } on TypeError {
          return false;
        }
      });
  }

  static Set<String> pendingDeleteIds(
    dynamic rawOutbox, {
    required String expectedUserId,
  }) {
    if (!isUuid(expectedUserId)) {
      throw ArgumentError.value(expectedUserId, 'expectedUserId');
    }
    if (rawOutbox is! List) return <String>{};
    final ids = <String>{};
    for (final entry in rawOutbox) {
      if (entry is! Map) continue;
      try {
        final operation = Map<String, dynamic>.from(entry);
        final owner = operation['user_id'];
        if (isValidOperation(operation) &&
            operation['operation'] == 'delete' &&
            (owner == null || owner == expectedUserId)) {
          ids.add(operation['id'] as String);
        }
      } on TypeError {
        // A map with non-string keys is malformed; ignore it here while
        // leaving the original durable entry available for quarantine.
      }
    }
    return ids;
  }

  static bool _isCurrentAccount(
    SupabaseClient? client,
    LocalStore localStore,
    String expectedUserId,
  ) =>
      client != null &&
      client.auth.currentUser?.id == expectedUserId &&
      !localStore.isSwitchingAccount &&
      localStore.activeUserId == expectedUserId;

  /// Preserve a malformed quarantine container as a recoverable entry
  /// instead of replacing it with an empty list during an unrelated retry.
  static List<dynamic> preserveQuarantineContainer(
    dynamic raw, {
    DateTime? now,
  }) {
    if (raw is List) return List<dynamic>.from(raw);
    if (raw == null) return <dynamic>[];
    return <dynamic>[
      <String, dynamic>{
        'reason': 'malformed-quarantine-container',
        'quarantinedAt': (now ?? DateTime.now()).toUtc().toIso8601String(),
        'operation': raw,
      },
    ];
  }

  static Future<void> _persistLocalOutboxes({
    required LocalStore localStore,
    required String expectedUserId,
    required List<dynamic> outbox,
    required List<dynamic> quarantine,
  }) async {
    await localStore.writeBatchForAccount(
      expectedUserId,
      writes: {
        outboxKey: outbox,
        quarantineKey: quarantine,
      },
      localOnlyKeys: const {outboxKey, quarantineKey},
      enqueueSync: false,
      notify: false,
    );
  }

  static Future<void> _quarantineEntry({
    required LocalStore localStore,
    required String expectedUserId,
    required dynamic rawEntry,
    required String reason,
  }) async {
    if (localStore.isSwitchingAccount ||
        localStore.activeUserId != expectedUserId) {
      return;
    }
    final rawOutbox = localStore.read(outboxKey);
    if (rawOutbox is! List) return;
    final outbox = List<dynamic>.from(rawOutbox);
    final index = outbox.indexWhere((entry) => identical(entry, rawEntry));
    if (index < 0) return;

    final quarantined = outbox.removeAt(index);
    final quarantine = preserveQuarantineContainer(
      localStore.read(quarantineKey),
    );
    quarantine.add({
      'reason': reason,
      'quarantinedAt': DateTime.now().toUtc().toIso8601String(),
      'operation': quarantined,
    });
    await _persistLocalOutboxes(
      localStore: localStore,
      expectedUserId: expectedUserId,
      outbox: outbox,
      quarantine: quarantine,
    );
  }

  /// Fetch every page before returning a snapshot. Uses the immutable UUID
  /// primary key as its cursor so inserts/updates to created_at cannot shift an
  /// offset and silently skip a row.
  static Future<List<Map<String, dynamic>>?> fetchAllKeysetPages({
    required Future<List<Map<String, dynamic>>?> Function(
      String? afterId,
      int pageSize,
    ) fetchPage,
    int pageSize = 500,
    bool Function()? isCancelled,
  }) async {
    if (pageSize < 1) throw ArgumentError.value(pageSize, 'pageSize');
    final cancelled = isCancelled ?? () => false;
    final rows = <Map<String, dynamic>>[];
    String? cursor;

    while (true) {
      if (cancelled()) return null;
      List<Map<String, dynamic>>? page;
      try {
        page = await fetchPage(cursor, pageSize);
      } catch (_) {
        return null;
      }
      if (cancelled() || page == null || page.length > pageSize) return null;

      var lastId = cursor;
      for (final row in page) {
        final id = row['id'];
        if (id is! String || id.isEmpty ||
            (lastId != null && id.compareTo(lastId) <= 0)) {
          return null;
        }
        lastId = id;
      }

      rows.addAll(page);
      if (page.length < pageSize) return rows;
      if (lastId == null) return null;
      cursor = lastId;
    }
  }

  static Future<List<Map<String, dynamic>>?> fetchForDay({
    required SupabaseClient? client,
    required LocalStore localStore,
    required String expectedUserId,
    required String logDate,
    String? createdAtSince,
  }) async {
    if (!_isCurrentAccount(client, localStore, expectedUserId) ||
        !isCalendarDate(logDate) ||
        (createdAtSince != null && !LocalStore.isValidRemoteTimestamp(createdAtSince))) {
      return null;
    }
    return fetchAllTuplePages(
      pageSize: 500,
      isCancelled: () => !_isCurrentAccount(client, localStore, expectedUserId),
      fetchPage: (afterCreatedAt, afterId, pageSize) async {
        var query = client!
            .from('food_log')
            .select(_select)
            .eq('user_id', expectedUserId)
            .eq('log_date', logDate);
        if (createdAtSince != null) {
          query = query.gte('created_at', createdAtSince);
        }
        if (afterCreatedAt != null && afterId != null) {
          query = query.or(
            'created_at.gt.$afterCreatedAt,and(created_at.eq.$afterCreatedAt,id.gt.$afterId)',
          );
        }
        final page = await query
            .order('created_at', ascending: true)
            .order('id', ascending: true)
            .limit(pageSize);
        if (!_isCurrentAccount(client, localStore, expectedUserId)) return null;
        return page
            .map((row) => Map<String, dynamic>.from(row))
            .toList(growable: false);
      },
    );
  }

  static Map<String, String> queueDeletedId(
    dynamic rawTombstones, {
    required String id,
    required DateTime now,
  }) {
    if (!isUuid(id)) throw ArgumentError.value(id, 'id');
    final cutoff = now.toUtc().subtract(tombstoneRetention);
    final entries = <String, DateTime>{};
    if (rawTombstones is Map) {
      for (final entry in rawTombstones.entries) {
        final key = entry.key;
        final value = entry.value;
        if (key is! String ||
            !isUuid(key) ||
            value is! String ||
            !LocalStore.isValidRemoteTimestamp(value)) {
          continue;
        }
        final timestamp = DateTime.tryParse(value)?.toUtc();
        if (timestamp == null ||
            timestamp.isBefore(cutoff) ||
            timestamp.isAfter(now.toUtc().add(const Duration(minutes: 5)))) {
          continue;
        }
        entries[key] = timestamp;
      }
    }
    entries[id] = now.toUtc();
    final ordered = entries.entries.toList()
      ..sort((left, right) => left.value.compareTo(right.value));
    while (ordered.length > maximumTombstones) {
      final oldest = ordered.removeAt(0);
      entries.remove(oldest.key);
    }
    return entries.map((key, value) => MapEntry(key, value.toIso8601String()));
  }

  static Set<String> activeDeletedIds(
    dynamic rawTombstones, {
    DateTime? now,
  }) {
    if (rawTombstones is! Map) return <String>{};
    final current = (now ?? DateTime.now()).toUtc();
    final cutoff = current.subtract(tombstoneRetention);
    return rawTombstones.entries
        .where((entry) {
          if (entry.key is! String ||
              !isUuid(entry.key as String) ||
              entry.value is! String ||
              !LocalStore.isValidRemoteTimestamp(entry.value as String)) {
            return false;
          }
          final timestamp = DateTime.tryParse(entry.value as String)?.toUtc();
          return timestamp != null &&
              !timestamp.isBefore(cutoff) &&
              !timestamp.isAfter(current.add(const Duration(minutes: 5)));
        })
        .map((entry) => entry.key as String)
        .toSet();
  }

  static Set<String> pendingDeletes(LocalStore localStore) {
    final expectedUserId = localStore.activeUserId;
    if (expectedUserId == null) return <String>{};
    return pendingDeleteIds(
      localStore.read(outboxKey),
      expectedUserId: expectedUserId,
    );
  }

  static Future<void> pushPending({
    required SupabaseClient? client,
    required LocalStore localStore,
    required String expectedUserId,
  }) async {
    if (!_isCurrentAccount(client, localStore, expectedUserId)) return;
    final raw = localStore.read(outboxKey);
    if (raw is! List) return;
    final pending = List<dynamic>.from(raw);

    for (final rawEntry in pending) {
      if (!_isCurrentAccount(client, localStore, expectedUserId)) return;
      if (rawEntry is! Map) {
        await _quarantineEntry(
          localStore: localStore,
          expectedUserId: expectedUserId,
          rawEntry: rawEntry,
          reason: 'invalid-food-log-operation-shape',
        );
        continue;
      }
      Map<String, dynamic> operation;
      try {
        operation = Map<String, dynamic>.from(rawEntry);
      } on TypeError {
        await _quarantineEntry(
          localStore: localStore,
          expectedUserId: expectedUserId,
          rawEntry: rawEntry,
          reason: 'invalid-food-log-operation-map-keys',
        );
        continue;
      }
      if (!isValidOperation(operation)) {
        await _quarantineEntry(
          localStore: localStore,
          expectedUserId: expectedUserId,
          rawEntry: rawEntry,
          reason: 'invalid-food-log-operation-shape',
        );
        continue;
      }
      if (operation['user_id'] != null &&
          operation['user_id'] != expectedUserId) {
        await _quarantineEntry(
          localStore: localStore,
          expectedUserId: expectedUserId,
          rawEntry: rawEntry,
          reason: 'food-log-operation-owner-mismatch',
        );
        continue;
      }
      if (!isOperationDue(operation)) continue;

      try {
        final id = operation['id'] as String;
        if (operation['operation'] == 'upsert') {
          final row = Map<String, dynamic>.from(operation['row'] as Map);
          if (row['user_id'] != expectedUserId) {
            await _quarantineEntry(
              localStore: localStore,
              expectedUserId: expectedUserId,
              rawEntry: rawEntry,
              reason: 'food-log-operation-account-mismatch',
            );
            continue;
          }
          // Stable-UUID retries are idempotent, but a newer queued
          // replacement must update the row rather than be ignored as a
          // duplicate. The row owner is checked above and RLS remains active.
          final response = await client!.from('food_log').upsert(
            row,
            onConflict: 'id',
          );
          throwIfPostgrestWriteFailed(response.error);
        } else {
          final response = await client!
              .from('food_log')
              .delete()
              .eq('user_id', expectedUserId)
              .eq('id', id);
          throwIfPostgrestWriteFailed(response.error);
        }

        if (!_isCurrentAccount(client, localStore, expectedUserId)) return;
        final current = localStore.read(outboxKey);
        final remaining = removeOperation(current, operation);
        final quarantine = preserveQuarantineContainer(
          localStore.read(quarantineKey),
        );
        await _persistLocalOutboxes(
          localStore: localStore,
          expectedUserId: expectedUserId,
          outbox: remaining,
          quarantine: quarantine,
        );
      } catch (_) {
        // Keep the command durable and avoid retrying it on every minute tick.
        // A later retry is idempotent by the stable row UUID.
        if (!_isCurrentAccount(client, localStore, expectedUserId)) return;
        try {
          final current = localStore.read(outboxKey);
          final deferred = deferOperation(
            current,
            operation,
            now: DateTime.now().toUtc(),
          );
          final quarantine = preserveQuarantineContainer(
            localStore.read(quarantineKey),
          );
          await _persistLocalOutboxes(
            localStore: localStore,
            expectedUserId: expectedUserId,
            outbox: deferred,
            quarantine: quarantine,
          );
        } catch (_) {
          // A failed local flush leaves the original durable command intact.
        }
        continue;
      }
    }
  }
}
