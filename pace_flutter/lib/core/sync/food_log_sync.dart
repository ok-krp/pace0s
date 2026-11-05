import 'package:supabase_flutter/supabase_flutter.dart';

import '../storage/local_store.dart';

/// Account-scoped, durable synchronization for the relational food_log table.
///
/// Nutrition JSON remains a local presentation cache. New authenticated
/// mutations are written to this outbox and never mirrored into user_state.
class FoodLogSync {
  static const String outboxKey = 'pace.__sync_food_log_outbox';
  static const String quarantineKey = 'pace.__sync_food_log_quarantine';
  static const String deletedIdsKey = 'pace.nutrition.deleted_ids';
  static const Duration tombstoneRetention = Duration(days: 90);
  static const int maximumTombstones = 500;

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

  static bool isValidOperation(Map<String, dynamic> operation) {
    final id = operation['id'];
    final queuedAt = operation['queuedAt'];
    final kind = operation['operation'];
    if (id is! String ||
        !isUuid(id) ||
        queuedAt is! String ||
        !LocalStore.isValidRemoteTimestamp(queuedAt)) {
      return false;
    }
    if (kind == 'delete') return true;
    if (kind != 'upsert' || operation['row'] is! Map) return false;

    final row = Map<String, dynamic>.from(operation['row'] as Map);
    if (row['id'] != id ||
        row['user_id'] is! String ||
        (row['user_id'] as String).isEmpty ||
        row['log_date'] is! String ||
        !isCalendarDate(row['log_date'] as String) ||
        row['meal'] is! String ||
        (row['meal'] as String).trim().isEmpty ||
        row['name'] is! String ||
        (row['name'] as String).trim().isEmpty ||
        !const {'manual', 'barcode', 'photo', 'recipe'}.contains(row['source'])) {
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
    Map<String, dynamic>? row,
    required DateTime now,
  }) {
    if (!isUuid(id)) throw ArgumentError.value(id, 'id');
    if (operation != 'upsert' && operation != 'delete') {
      throw ArgumentError.value(operation, 'operation');
    }
    if (operation == 'upsert' && row == null) {
      throw ArgumentError('An upsert requires a food_log row');
    }

    final entries = rawOutbox is List
        ? List<dynamic>.from(rawOutbox)
        : <dynamic>[];
    DateTime? previousAt;
    for (final entry in entries) {
      if (entry is! Map || entry['id'] != id || entry['queuedAt'] is! String) {
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
      'operation': operation,
      'queuedAt': queuedAt,
      if (operation == 'upsert') 'row': Map<String, dynamic>.from(row!),
    };
    if (!isValidOperation(replacement)) {
      throw ArgumentError('Invalid food_log outbox operation');
    }
    entries.removeWhere((entry) => entry is Map && entry['id'] == id);
    entries.add(replacement);
    return entries;
  }

  /// Remove only the exact command whose request completed. An older in-flight
  /// acknowledgement must not delete a newer command for the same row ID.
  static List<dynamic> removeOperation(
    dynamic rawOutbox,
    Map<String, dynamic> completed,
  ) {
    if (rawOutbox is! List) return <dynamic>[];
    return List<dynamic>.from(rawOutbox)
      ..removeWhere((entry) =>
          entry is Map &&
          entry['id'] == completed['id'] &&
          entry['operation'] == completed['operation'] &&
          entry['queuedAt'] == completed['queuedAt']);
  }

  static Set<String> pendingDeleteIds(dynamic rawOutbox) {
    if (rawOutbox is! List) return <String>{};
    return rawOutbox
        .whereType<Map>()
        .map((entry) => Map<String, dynamic>.from(entry))
        .where((entry) => isValidOperation(entry) && entry['operation'] == 'delete')
        .map((entry) => entry['id'] as String)
        .toSet();
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
    final rawQuarantine = localStore.read(quarantineKey);
    final quarantine = rawQuarantine is List
        ? List<dynamic>.from(rawQuarantine)
        : <dynamic>[];
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

  static Future<List<Map<String, dynamic>>?> fetchForDay({
    required SupabaseClient? client,
    required LocalStore localStore,
    required String expectedUserId,
    required String logDate,
  }) async {
    if (!_isCurrentAccount(client, localStore, expectedUserId) ||
        !isCalendarDate(logDate)) {
      return null;
    }
    try {
      final rows = await client!
          .from('food_log')
          .select(_select)
          .eq('user_id', expectedUserId)
          .eq('log_date', logDate)
          .order('created_at', ascending: true)
          .limit(1000);
      if (!_isCurrentAccount(client, localStore, expectedUserId)) return null;
      return rows
          .map((row) => Map<String, dynamic>.from(row))
          .toList(growable: false);
    } catch (_) {
      return null;
    }
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

  static Set<String> pendingDeletes(LocalStore localStore) =>
      pendingDeleteIds(localStore.read(outboxKey));

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
      final operation = Map<String, dynamic>.from(rawEntry);
      if (!isValidOperation(operation)) {
        await _quarantineEntry(
          localStore: localStore,
          expectedUserId: expectedUserId,
          rawEntry: rawEntry,
          reason: 'invalid-food-log-operation-shape',
        );
        continue;
      }

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
          await client!.from('food_log').upsert(
                row,
                onConflict: 'id',
                ignoreDuplicates: true,
              );
        } else {
          await client!
              .from('food_log')
              .delete()
              .eq('user_id', expectedUserId)
              .eq('id', id);
        }

        if (!_isCurrentAccount(client, localStore, expectedUserId)) return;
        final current = localStore.read(outboxKey);
        final remaining = removeOperation(current, operation);
        final rawQuarantine = localStore.read(quarantineKey);
        final quarantine = rawQuarantine is List
            ? List<dynamic>.from(rawQuarantine)
            : <dynamic>[];
        await _persistLocalOutboxes(
          localStore: localStore,
          expectedUserId: expectedUserId,
          outbox: remaining,
          quarantine: quarantine,
        );
      } catch (_) {
        // Keep the command durable after a transient network or local flush
        // failure. A later retry is idempotent by the stable row UUID.
        continue;
      }
    }
  }
}
