import 'package:flutter_test/flutter_test.dart';
import 'package:pace_flutter/core/sync/sync_service.dart';

void main() {
  group('Realtime account isolation', () {
    test('accepts a callback only for the currently authenticated subscription', () {
      expect(
        shouldAcceptRealtimeUserStateForAccount(
          authenticatedUserId: 'user-a',
          subscribedUserId: 'user-a',
          activeRealtimeUserId: 'user-a',
        ),
        isTrue,
      );
    });

    test('rejects a late callback after sign-out', () {
      expect(
        shouldAcceptRealtimeUserStateForAccount(
          authenticatedUserId: null,
          subscribedUserId: 'user-a',
          activeRealtimeUserId: 'user-a',
        ),
        isFalse,
      );
    });

    test('rejects a previous account callback after account switch', () {
      expect(
        shouldAcceptRealtimeUserStateForAccount(
          authenticatedUserId: 'user-b',
          subscribedUserId: 'user-a',
          activeRealtimeUserId: 'user-a',
        ),
        isFalse,
      );
    });

    test('rejects callbacks after the old channel has been invalidated', () {
      expect(
        shouldAcceptRealtimeUserStateForAccount(
          authenticatedUserId: 'user-a',
          subscribedUserId: 'user-a',
          activeRealtimeUserId: null,
        ),
        isFalse,
      );
    });
  });
}
