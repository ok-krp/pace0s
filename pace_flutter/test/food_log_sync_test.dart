import 'package:flutter_test/flutter_test.dart';
import 'package:pace/core/sync/food_log_sync.dart';

void main() {
  const id = '00000000-0000-4000-8000-000000000001';
  const otherId = '00000000-0000-4000-8000-000000000002';
  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  Map<String, dynamic> row(String rowId) => <String, dynamic>{
        'id': rowId,
        'user_id': userId,
        'log_date': '2026-11-05',
        'meal': 'Repas',
        'name': 'Test food',
        'kcal': 120,
        'protein_g': 10,
        'carbs_g': 12,
        'fat_g': 4,
        'fiber_g': 2,
        'sugar_g': 3,
        'sodium_mg': 80,
        'source': 'manual',
        'meta': <String, dynamic>{'client': 'pace_flutter'},
      };

  test('accepts canonical UUIDs and calendar dates only', () {
    expect(FoodLogSync.isUuid(id), isTrue);
    expect(FoodLogSync.isUuid('not-a-uuid'), isFalse);
    expect(FoodLogSync.isUuid('00000000-0000-0000-0000-000000000001'), isFalse);
    expect(FoodLogSync.isCalendarDate('2026-11-05'), isTrue);
    expect(FoodLogSync.isCalendarDate('2026-02-30'), isFalse);
    expect(FoodLogSync.isCalendarDate('2026-2-5'), isFalse);
  });

  test('validates upsert and delete commands and rejects malformed nutrients', () {
    expect(
      FoodLogSync.isValidOperation({
        'id': id,
        'operation': 'upsert',
        'queuedAt': '2026-11-05T09:00:00.000Z',
        'row': row(id),
      }),
      isTrue,
    );
    expect(
      FoodLogSync.isValidOperation({
        'id': id,
        'operation': 'delete',
        'queuedAt': '2026-11-05T09:00:00.000Z',
      }),
      isTrue,
    );
    expect(
      FoodLogSync.isValidOperation({
        'id': id,
        'operation': 'upsert',
        'queuedAt': '2026-11-05T09:00:00.000Z',
        'row': {...row(id), 'kcal': double.nan},
      }),
      isFalse,
    );
    expect(
      FoodLogSync.isValidOperation({
        'id': id,
        'operation': 'upsert',
        'queuedAt': '2026-11-05T09:00:00.000Z',
        'row': {...row(id), 'log_date': '2026-02-30'},
      }),
      isFalse,
    );
    expect(
      FoodLogSync.isValidOperation({
        'id': id,
        'operation': 'upsert',
        'queuedAt': '2026-11-05T09:00:00.000Z',
        'row': {...row(id), 'health_score': 'purple'},
      }),
      isFalse,
    );
    expect(
      FoodLogSync.isValidOperation({
        'id': id,
        'operation': 'upsert',
        'queuedAt': '2026-11-05T09:00:00.000Z',
        'row': {...row(id), 'meta': 'not-an-object'},
      }),
      isFalse,
    );
    expect(
      FoodLogSync.isValidOperation({
        'id': id,
        'operation': 'upsert',
        'queuedAt': '2026-11-05T09:00:00.000Z',
        'row': <dynamic, dynamic>{1: 'non-string row key'},
      }),
      isFalse,
    );
    expect(
      FoodLogSync.isValidOperation({
        'id': id,
        'operation': 'upsert',
        'queuedAt': '2026-11-05T09:00:00.000Z',
        'row': {
          ...row(id),
          'meta': <dynamic, dynamic>{1: 'non-string nested metadata key'},
        },
      }),
      isFalse,
    );
    expect(
      FoodLogSync.isValidOperation({
        'id': id,
        'operation': 'upsert',
        'queuedAt': '2026-11-05T09:00:00.000Z',
        'attempts': null,
        'row': row(id),
      }),
      isFalse,
    );
    expect(
      FoodLogSync.isValidOperation({
        'id': id,
        'operation': 'upsert',
        'queuedAt': '2026-11-05T09:00:00.000Z',
        'nextAttemptAt': null,
        'row': row(id),
      }),
      isFalse,
    );
    expect(
      FoodLogSync.isValidOperation({
        'id': id,
        'operation': 'upsert',
        'queuedAt': '2026-11-05T09:00:00',
        'row': row(id),
      }),
      isFalse,
    );
  });

  test('rejects an upsert whose row belongs to a different account', () {
    expect(
      () => FoodLogSync.queueOperation(
        const <dynamic>[],
        operation: 'upsert',
        id: id,
        expectedUserId: userId,
        row: {...row(id), 'user_id': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},
        now: DateTime.utc(2026, 11, 6, 12),
      ),
      throwsArgumentError,
    );
    expect(
      () => FoodLogSync.queueOperation(
        const <dynamic>[],
        operation: 'delete',
        id: id,
        expectedUserId: 'not-a-user-id',
        now: DateTime.utc(2026, 11, 6, 12),
      ),
      throwsArgumentError,
    );
  });

  test('caps native pending operations without dropping existing rows', () {
    final full = List<dynamic>.generate(
      FoodLogSync.maximumPendingOperations,
      (index) => <String, dynamic>{
        'id':
            '00000000-0000-4000-8000-${(index + 1).toString().padLeft(12, '0')}',
        'operation': 'delete',
        'queuedAt': '2026-11-05T09:00:00.000Z',
      },
    );

    expect(
      () => FoodLogSync.queueOperation(
        full,
        operation: 'delete',
        id: '00000000-0000-4000-8000-000000000000',
        expectedUserId: userId,
        now: DateTime.utc(2026, 11, 5, 10),
      ),
      throwsStateError,
    );
    expect(full, hasLength(FoodLogSync.maximumPendingOperations));

    final replacement = FoodLogSync.queueOperation(
      full,
      operation: 'delete',
      id: id,
      expectedUserId: userId,
      now: DateTime.utc(2026, 11, 5, 10),
    );
    expect(replacement, hasLength(FoodLogSync.maximumPendingOperations));
  });

  test('replacing an upsert with a delete preserves the newer command', () {
    final now = DateTime.utc(2026, 11, 5, 9);
    final inserted = FoodLogSync.queueOperation(
      const <dynamic>[],
      operation: 'upsert',
      id: id,
      row: row(id),
      expectedUserId: userId,
      now: now,
    );
    final original = Map<String, dynamic>.from(inserted.single as Map);
    final replaced = FoodLogSync.queueOperation(
      inserted,
      operation: 'delete',
      id: id,
      expectedUserId: userId,
      now: now,
    );

    expect(replaced, hasLength(1));
    expect((replaced.single as Map)['operation'], 'delete');
    expect(
      FoodLogSync.removeOperation(replaced, original),
      hasLength(1),
      reason: 'an old in-flight acknowledgement must not remove a replacement',
    );
    expect(FoodLogSync.pendingDeleteIds(replaced), {id});
  });

  test('preserves malformed outbox roots when queueing and acknowledging', () {
    final malformedRoot = <String, dynamic>{'legacy': 'recoverable-payload'};
    final queued = FoodLogSync.queueOperation(
      malformedRoot,
      operation: 'delete',
      id: id,
      expectedUserId: userId,
      now: DateTime.utc(2026, 11, 5, 9),
    );

    expect(queued, hasLength(2));
    expect(identical(queued.first, malformedRoot), isTrue);
    expect(
      FoodLogSync.removeOperation(malformedRoot, {
        'id': id,
        'operation': 'delete',
        'queuedAt': '2026-11-05T09:00:00.000Z',
      }),
      [malformedRoot],
    );
  });

  test('does not discard malformed same-ID entries when replacing an operation', () {
    final malformed = <String, dynamic>{
      'id': id,
      'operation': 'upsert',
      'queuedAt': '2026-11-05T09:00:00.000Z',
      'row': row(otherId),
    };
    final queued = FoodLogSync.queueOperation(
      [malformed],
      operation: 'delete',
      id: id,
      expectedUserId: userId,
      now: DateTime.utc(2026, 11, 5, 9),
    );

    expect(queued, hasLength(2));
    expect(identical(queued.first, malformed), isTrue);
    expect((queued.last as Map)['operation'], 'delete');
  });

  test('ignores non-string-key corrupt maps when deriving pending deletes', () {
    final malformed = <dynamic, dynamic>{1: 'not-a-json-operation'};
    expect(FoodLogSync.pendingDeleteIds([malformed]), isEmpty);
  });

  test('preserves a malformed native quarantine container before appending', () {
    final malformed = <String, dynamic>{'legacy': 'quarantine-payload'};
    final preserved = FoodLogSync.preserveQuarantineContainer(
      malformed,
      now: DateTime.utc(2026, 11, 6, 12),
    );

    expect(preserved, hasLength(1));
    expect(preserved.single, {
      'reason': 'malformed-quarantine-container',
      'quarantinedAt': '2026-11-06T12:00:00.000Z',
      'operation': malformed,
    });
    expect(FoodLogSync.preserveQuarantineContainer(null), isEmpty);
    expect(
      FoodLogSync.preserveQuarantineContainer([{'existing': true}]),
      [{'existing': true}],
    );
  });

  test('backs off failed native food-log writes with a bounded retry delay', () {
    final now = DateTime.utc(2026, 11, 6, 12);
    final queued = FoodLogSync.queueOperation(
      const <dynamic>[],
      operation: 'upsert',
      id: id,
      row: row(id),
      expectedUserId: userId,
      now: now,
    );
    final original = Map<String, dynamic>.from(queued.single as Map);
    final firstRetry = FoodLogSync.deferOperation(
      queued,
      original,
      now: now,
    );
    final first = Map<String, dynamic>.from(firstRetry.single as Map);

    expect(first['attempts'], 1);
    expect(first['nextAttemptAt'], '2026-11-06T12:01:00.000Z');
    expect(FoodLogSync.isOperationDue(first, now: now), isFalse);
    expect(
      FoodLogSync.isOperationDue(
        first,
        now: now.add(const Duration(minutes: 1)),
      ),
      isTrue,
    );

    final secondRetry = FoodLogSync.deferOperation(
      firstRetry,
      first,
      now: now.add(const Duration(minutes: 1)),
    );
    final second = Map<String, dynamic>.from(secondRetry.single as Map);
    expect(second['attempts'], 2);
    expect(second['nextAttemptAt'], '2026-11-06T12:03:00.000Z');

    final replacement = FoodLogSync.queueOperation(
      secondRetry,
      operation: 'upsert',
      id: id,
      row: {...row(id), 'name': 'Updated food'},
      expectedUserId: userId,
      now: now.add(const Duration(minutes: 1)),
    );
    final current = Map<String, dynamic>.from(
      replacement.singleWhere((entry) => (entry as Map)['id'] == id) as Map,
    );
    expect(current.containsKey('attempts'), isFalse);
    expect(current.containsKey('nextAttemptAt'), isFalse);
    expect(FoodLogSync.isOperationDue(current, now: now), isTrue);
  });

  test('keeps unrelated rows independent and queues monotonic timestamps', () {
    final now = DateTime.utc(2026, 11, 5, 9);
    final first = FoodLogSync.queueOperation(
      const <dynamic>[],
      operation: 'delete',
      id: id,
      expectedUserId: userId,
      now: now,
    );
    final firstTimestamp = (first.single as Map)['queuedAt'] as String;
    final second = FoodLogSync.queueOperation(
      first,
      operation: 'delete',
      id: otherId,
      expectedUserId: userId,
      now: now,
    );
    final replaced = FoodLogSync.queueOperation(
      second,
      operation: 'delete',
      id: id,
      expectedUserId: userId,
      now: now,
    );

    expect(replaced, hasLength(2));
    final idTimestamp = (replaced.firstWhere((entry) => entry['id'] == id) as Map)['queuedAt'] as String;
    expect(DateTime.parse(idTimestamp).isAfter(DateTime.parse(firstTimestamp)), isTrue);
    expect(FoodLogSync.pendingDeleteIds(replaced), {id, otherId});
  });


  test('maps optional micronutrients from canonical food-log metadata', () {
    final mapped = FoodLogSync.mapFoodLogRowToNutritionItem({
      ...row(id),
      'created_at': '2026-11-06T12:00:00.000Z',
      'meta': {
        'sat_fat_g': 2.5,
        'salt_g': 0.8,
        'iron_mg': 3.2,
        'calcium_mg': 120,
        'vitamin_c_mg': 14,
      },
    });

    expect(mapped['sat'], 2.5);
    expect(mapped['salt'], 0.8);
    expect(mapped['iron'], 3.2);
    expect(mapped['calcium'], 120);
    expect(mapped['vitC'], 14);
    expect(mapped['__foodLogCanonical'], isTrue);
  });

  test('keeps blank optional micronutrients null during canonical mapping', () {
    final mapped = FoodLogSync.mapFoodLogRowToNutritionItem({
      ...row(id),
      'meta': {
        'missing_nutrients': ['fiber_g', 'sugar_g', 'sodium_mg'],
      },
    });

    expect(mapped['fiber'], isNull);
    expect(mapped['sugar'], isNull);
    expect(mapped['sodium'], isNull);
  });

  test('keeps deliberately missing macros null during canonical mapping', () {
    final mapped = FoodLogSync.mapFoodLogRowToNutritionItem({
      ...row(id),
      'meta': {'missing_nutrients': ['kcal', 'protein_g']},
    });

    expect(mapped['kcal'], isNull);
    expect(mapped['p'], isNull);
    expect(mapped['c'], row(id)['carbs_g']);
    expect(mapped['f'], row(id)['fat_g']);
  });

  test('fetches every food-log UUID page beyond 1,000 rows', () async {
    String uuid(int value) =>
        '00000000-0000-4000-8000-${value.toString().padLeft(12, '0')}';
    final source = List.generate(
      1207,
      (index) => <String, dynamic>{'id': uuid(index + 1), 'value': index},
    );
    final cursors = <String?>[];

    final rows = await FoodLogSync.fetchAllKeysetPages(
      pageSize: 500,
      fetchPage: (afterId, limit) async {
        cursors.add(afterId);
        final start = afterId == null
            ? 0
            : source.indexWhere((row) => row['id'] == afterId) + 1;
        return source.skip(start).take(limit).toList();
      },
    );

    expect(rows, source);
    expect(cursors, [null, source[499]['id'], source[999]['id']]);
  });

  test('rejects a partial food-log snapshot when a later page fails', () async {
    var calls = 0;
    final rows = await FoodLogSync.fetchAllKeysetPages(
      pageSize: 2,
      fetchPage: (afterId, limit) async {
        calls++;
        if (calls == 1) {
          return [
            {'id': 'a'},
            {'id': 'b'},
          ];
        }
        return null;
      },
    );

    expect(rows, isNull);
    expect(calls, 2);
  });

  test('rejects repeated or non-progressing food-log cursors', () async {
    var calls = 0;
    final rows = await FoodLogSync.fetchAllKeysetPages(
      pageSize: 2,
      fetchPage: (afterId, limit) async {
        calls++;
        return calls == 1
            ? [
                {'id': 'b'},
                {'id': 'c'},
              ]
            : [
                {'id': 'c'},
                {'id': 'd'},
              ];
      },
    );

    expect(rows, isNull);
    expect(calls, 2);
  });

  test('stops food-log pagination when account scope is cancelled', () async {
    var cancelled = false;
    var calls = 0;
    final rows = await FoodLogSync.fetchAllKeysetPages(
      pageSize: 2,
      isCancelled: () => cancelled,
      fetchPage: (afterId, limit) async {
        calls++;
        cancelled = true;
        return [{'id': 'a'}];
      },
    );

    expect(rows, isNull);
    expect(calls, 1);
  });

  test('rejects invalid food-log pagination page sizes', () async {
    await expectLater(
      FoodLogSync.fetchAllKeysetPages(
        pageSize: 0,
        fetchPage: (afterId, limit) async => <Map<String, dynamic>>[],
      ),
      throwsArgumentError,
    );
  });


  test('requires full Nutrition reconciliation when the cursor is missing, stale or for another day', () {
    final now = DateTime.utc(2026, 11, 6, 12);
    final cursor = <String, dynamic>{
      'logDate': '2026-11-06',
      'createdAt': '2026-11-06T11:59:00.000Z',
      'id': id,
      'lastFullAt': now.subtract(const Duration(minutes: 1)).toIso8601String(),
    };

    expect(
      FoodLogSync.shouldRunFullFoodLogReconciliation(
        cursor: null,
        logDate: '2026-11-06',
        now: now,
      ),
      isTrue,
    );
    expect(
      FoodLogSync.shouldRunFullFoodLogReconciliation(
        cursor: cursor,
        logDate: '2026-11-07',
        now: now,
      ),
      isTrue,
    );
    expect(
      FoodLogSync.shouldRunFullFoodLogReconciliation(
        cursor: {
          ...cursor,
          'lastFullAt': now.subtract(const Duration(days: 1)).toIso8601String(),
        },
        logDate: '2026-11-06',
        now: now,
      ),
      isTrue,
    );
    expect(
      FoodLogSync.shouldRunFullFoodLogReconciliation(
        cursor: cursor,
        logDate: '2026-11-06',
        now: now,
      ),
      isFalse,
    );
  });

  test('parses only valid per-day food-log cursors', () {
    final raw = <String, dynamic>{
      'logDate': '2026-11-06',
      'createdAt': '2026-11-06T11:59:00.123456Z',
      'id': id,
      'lastFullAt': '2026-11-06T11:00:00.000Z',
    };
    expect(
      FoodLogSync.parseFoodLogCursor(raw, logDate: '2026-11-06'),
      raw,
    );
    expect(FoodLogSync.parseFoodLogCursor(raw, logDate: '2026-11-07'), isNull);
    expect(
      FoodLogSync.parseFoodLogCursor({...raw, 'id': 'invalid'}, logDate: '2026-11-06'),
      isNull,
    );
    expect(
      FoodLogSync.parseFoodLogCursor({...raw, 'createdAt': 'invalid'}, logDate: '2026-11-06'),
      isNull,
    );
  });

  test('uses a bounded overlap when requesting a food-log delta', () {
    final since = FoodLogSync.foodLogDeltaSince({
      'createdAt': '2026-11-06T12:00:00.000Z',
    });
    expect(since, '2026-11-06T11:55:00.000Z');
  });

  test('advances a full scan past historical rows rather than rescanning them every minute', () {
    final now = DateTime.utc(2026, 11, 6, 12);
    final cursor = FoodLogSync.nextFoodLogCursor(
      previous: null,
      rows: [
        {
          ...row(id),
          'created_at': '2026-10-01T10:00:00.000Z',
        },
      ],
      logDate: '2026-11-06',
      fullReconciliation: true,
      now: now,
    );

    expect(cursor['createdAt'], '2026-11-06T12:00:00.000Z');
    expect(cursor['id'], isNull);
    expect(cursor['lastFullAt'], now.toIso8601String());
  });

  test('advances the watermark after an empty incremental delta', () {
    final now = DateTime.utc(2026, 11, 6, 12);
    final previous = <String, dynamic>{
      'logDate': '2026-11-06',
      'createdAt': '2026-11-06T11:59:00.000Z',
      'id': id,
      'lastFullAt': '2026-11-06T10:00:00.000Z',
    };
    final next = FoodLogSync.nextFoodLogCursor(
      previous: previous,
      rows: const [],
      logDate: '2026-11-06',
      fullReconciliation: false,
      now: now,
    );

    expect(next['createdAt'], '2026-11-06T12:00:00.000Z');
    expect(next['id'], isNull);
    expect(next['lastFullAt'], previous['lastFullAt']);
    expect(
      FoodLogSync.foodLogDeltaSince(next),
      '2026-11-06T11:55:00.000Z',
    );
  });

  test('fetches food-log tuple pages in created_at and UUID order', () async {
    Map<String, dynamic> entry(String entryId, String createdAt) => {
          ...row(entryId),
          'created_at': createdAt,
        };
    final source = [
      entry(id, '2026-11-06T12:00:00.123456Z'),
      entry(otherId, '2026-11-06T12:00:00.123456Z'),
      entry('00000000-0000-4000-8000-000000000003', '2026-11-06T12:00:00.123457Z'),
    ];
    final cursors = <String?>[];

    final rows = await FoodLogSync.fetchAllTuplePages(
      pageSize: 2,
      fetchPage: (afterCreatedAt, afterId, limit) async {
        cursors.add(afterId);
        final start = afterId == null
            ? 0
            : source.indexWhere((item) =>
                    item['created_at'] == afterCreatedAt &&
                    item['id'] == afterId) +
                1;
        return source.skip(start).take(limit).toList();
      },
    );

    expect(rows, source);
    expect(cursors, [null, otherId]);
  });

  test('does not return a partial tuple-paginated food-log snapshot', () async {
    var calls = 0;
    final rows = await FoodLogSync.fetchAllTuplePages(
      pageSize: 2,
      fetchPage: (afterCreatedAt, afterId, limit) async {
        calls++;
        if (calls == 1) {
          return [
            {...row(id), 'created_at': '2026-11-06T12:00:00.000Z'},
            {...row(otherId), 'created_at': '2026-11-06T12:00:00.001Z'},
          ];
        }
        return null;
      },
    );

    expect(rows, isNull);
    expect(calls, 2);
  });

  test('rejects duplicate or regressing timestamp and UUID cursors', () async {
    var calls = 0;
    final rows = await FoodLogSync.fetchAllTuplePages(
      pageSize: 2,
      fetchPage: (afterCreatedAt, afterId, limit) async {
        calls++;
        return calls == 1
            ? [
                {...row(id), 'created_at': '2026-11-06T12:00:00.000Z'},
                {...row(otherId), 'created_at': '2026-11-06T12:00:00.000Z'},
              ]
            : [
                {...row(otherId), 'created_at': '2026-11-06T12:00:00.000Z'},
                {...row(id), 'created_at': '2026-11-06T11:59:59.999Z'},
              ];
      },
    );

    expect(rows, isNull);
    expect(calls, 2);
  });

  test('merges incremental food-log rows without discarding older canonical items', () {
    final untouched = {
      ...row('00000000-0000-4000-8000-000000000099'),
      'name': 'Ancien repas',
      '__foodLogCanonical': true,
    };
    final legacy = {
      'id': 'legacy-row',
      'name': 'Ancienne ligne JSON',
    };
    final incoming = {
      ...row(id),
      'created_at': '2026-11-06T12:00:00.000Z',
      '__foodLogCanonical': true,
    };
    final merged = FoodLogSync.mergeCanonicalDelta(
      localItems: [untouched, legacy],
      remoteItems: [incoming],
    );

    expect(merged.map((item) => item['id']).toList(), [
      untouched['id'],
      legacy['id'],
      incoming['id'],
    ]);
  });

  test('incremental food-log merge replaces duplicate IDs and applies tombstones', () {
    final old = {...row(id), 'name': 'Ancienne version'};
    final deleted = {...row(otherId), 'name': 'Supprimé'};
    final updated = {...row(id), 'name': 'Version corrigée'};
    final merged = FoodLogSync.mergeCanonicalDelta(
      localItems: [old, deleted],
      remoteItems: [updated],
      deletedIds: {otherId},
    );

    expect(merged, hasLength(1));
    expect(merged.single['id'], id);
    expect(merged.single['name'], 'Version corrigée');
  });
}
