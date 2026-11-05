import 'package:flutter_test/flutter_test.dart';
import 'package:pace/core/sync/food_log_sync.dart';

void main() {
  const id = '00000000-0000-4000-8000-000000000001';
  const otherId = '00000000-0000-4000-8000-000000000002';

  Map<String, dynamic> row(String rowId) => <String, dynamic>{
        'id': rowId,
        'user_id': 'user-a',
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
        'queuedAt': '2026-11-05T09:00:00',
        'row': row(id),
      }),
      isFalse,
    );
  });

  test('replacing an upsert with a delete preserves the newer command', () {
    final now = DateTime.utc(2026, 11, 5, 9);
    final inserted = FoodLogSync.queueOperation(
      const <dynamic>[],
      operation: 'upsert',
      id: id,
      row: row(id),
      now: now,
    );
    final original = Map<String, dynamic>.from(inserted.single as Map);
    final replaced = FoodLogSync.queueOperation(
      inserted,
      operation: 'delete',
      id: id,
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

  test('keeps unrelated rows independent and queues monotonic timestamps', () {
    final now = DateTime.utc(2026, 11, 5, 9);
    final first = FoodLogSync.queueOperation(
      const <dynamic>[],
      operation: 'delete',
      id: id,
      now: now,
    );
    final firstTimestamp = (first.single as Map)['queuedAt'] as String;
    final second = FoodLogSync.queueOperation(
      first,
      operation: 'delete',
      id: otherId,
      now: now,
    );
    final replaced = FoodLogSync.queueOperation(
      second,
      operation: 'delete',
      id: id,
      now: now,
    );

    expect(replaced, hasLength(2));
    final idTimestamp = (replaced.firstWhere((entry) => entry['id'] == id) as Map)['queuedAt'] as String;
    expect(DateTime.parse(idTimestamp).isAfter(DateTime.parse(firstTimestamp)), isTrue);
    expect(FoodLogSync.pendingDeleteIds(replaced), {id, otherId});
  });
}
