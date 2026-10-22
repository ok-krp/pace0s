import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:pace/core/supabase/pace_supabase.dart';
import 'package:pace/features/auth/auth_page.dart';

void main() {
  testWidgets('auth screen offers local-only mode when cloud is unavailable', (tester) async {
    var continuedOffline = false;

    await tester.pumpWidget(
      MaterialApp(
        home: AuthPage(
          auth: const PaceAuthService(null),
          onContinueOffline: () => continuedOffline = true,
        ),
      ),
    );

    final button = find.text('Continuer hors connexion');
    expect(button, findsOneWidget);
    await tester.tap(button);
    expect(continuedOffline, isTrue);
  });

  testWidgets('offline escape remains enabled while sign-in is pending', (tester) async {
    final signIn = Completer<AuthResponse>();
    var continuedOffline = false;

    await tester.pumpWidget(
      MaterialApp(
        home: AuthPage(
          auth: _PendingAuthService(signIn),
          onContinueOffline: () => continuedOffline = true,
        ),
      ),
    );

    await tester.tap(find.widgetWithText(FilledButton, 'Se connecter'));
    await tester.pump();

    final offlineButton = tester.widget<OutlinedButton>(
      find.widgetWithText(OutlinedButton, 'Continuer hors connexion'),
    );
    expect(offlineButton.onPressed, isNotNull);

    await tester.tap(find.widgetWithText(OutlinedButton, 'Continuer hors connexion'));
    expect(continuedOffline, isTrue);

    signIn.completeError(StateError('simulated network failure'));
    await tester.pump();
  });
}

class _PendingAuthService extends PaceAuthService {
  _PendingAuthService(this.signIn) : super(null);

  final Completer<AuthResponse> signIn;

  @override
  Future<AuthResponse> signInWithPassword({
    required String email,
    required String password,
  }) =>
      signIn.future;
}
