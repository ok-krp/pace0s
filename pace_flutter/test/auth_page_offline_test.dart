import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
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
}
