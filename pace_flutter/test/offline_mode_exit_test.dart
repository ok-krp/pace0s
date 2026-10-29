import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:pace/app/pace_app.dart';
import 'package:pace/core/storage/local_store.dart';
import 'package:pace/core/supabase/pace_supabase.dart';
import 'package:pace/core/sync/sync_service.dart';

void main() {
  test('account activation guard never skips while a scope switch is pending', () {
    expect(
      shouldSkipAccountActivation(
        activationInProgress: true,
        activeUserId: null,
        requestedUserId: 'account-a',
        signedIn: false,
      ),
      isFalse,
    );
    expect(
      shouldSkipAccountActivation(
        activationInProgress: false,
        activeUserId: 'account-a',
        requestedUserId: null,
        signedIn: true,
      ),
      isFalse,
    );
    expect(
      shouldSkipAccountActivation(
        activationInProgress: false,
        activeUserId: 'account-a',
        requestedUserId: 'account-a',
        signedIn: true,
      ),
      isTrue,
    );
    expect(
      shouldSkipAccountActivation(
        activationInProgress: false,
        activeUserId: null,
        requestedUserId: null,
        signedIn: false,
      ),
      isTrue,
    );
  });

  testWidgets(
    'exiting offline mode restores a still-valid authenticated account',
    (tester) async {
      final directory = await tester.runAsync(
        () => Directory.systemTemp.createTemp('pace-offline-restore-'),
      );
      if (directory == null) throw StateError('Could not create test directory');
      final store = await tester.runAsync(
        () => LocalStore.open(directory: directory),
      );
      if (store == null) throw StateError('Could not open test local store');

      final auth = _MutableSessionAuthService();
      final user = User.fromJson({
        'id': 'restored-account',
        'app_metadata': <String, dynamic>{},
        'user_metadata': <String, dynamic>{},
        'aud': 'authenticated',
        'created_at': '2026-10-28T10:00:00Z',
      })!;

      addTearDown(() async {
        store.dispose();
        await tester.runAsync(() => directory.delete(recursive: true));
      });

      await tester.runAsync(() async {
        await store.activateAccount('restored-account');
        await store.write(
          'pace.profile.name',
          'restored account data',
          enqueueSync: false,
        );
        await store.activateAccount(null);
      });

      await tester.pumpWidget(
        MaterialApp(
          home: PaceApp(
            localStore: store,
            auth: auth,
            sync: SyncService(localStore: store, client: null),
          ),
        ),
      );
      expect(find.text('Continuer hors connexion'), findsOneWidget);
      await tester.tap(find.text('Continuer hors connexion'));
      final navigationBar = find.byType(NavigationBar);
      for (var attempt = 0;
          attempt < 20 && navigationBar.evaluate().isEmpty;
          attempt++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 100)),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 50));
      }
      expect(navigationBar, findsOneWidget);

      await tester.tap(find.text('Plus'));
      await tester.pump();
      expect(find.text('Revenir à la connexion'), findsOneWidget);

      // The auth facade still reports a valid user identity while the app
      // deliberately uses the isolated guest file in offline mode.
      auth.activeUser = user;
      await tester.tap(find.text('Revenir à la connexion'));

      for (var attempt = 0;
          attempt < 20 && store.activeUserId != user.id;
          attempt++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 100)),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 50));
      }

      expect(store.activeUserId, user.id);
      expect(store.read('pace.profile.name'), 'restored account data');
      expect(navigationBar, findsOneWidget);
    },
    timeout: const Timeout(Duration(seconds: 45)),
  );

  testWidgets(
    'sign-out during guest activation is handled after the transition',
    (tester) async {
      final directory = await tester.runAsync(
        () => Directory.systemTemp.createTemp('pace-offline-signout-race-'),
      );
      if (directory == null) throw StateError('Could not create test directory');
      final store = await tester.runAsync(
        () => LocalStore.open(directory: directory),
      );
      if (store == null) throw StateError('Could not open test local store');
      final auth = _EventSessionAuthService();
      addTearDown(() async {
        store.dispose();
        await auth.closeEvents();
        await tester.runAsync(() => directory.delete(recursive: true));
      });
      // Start from an authenticated account file so the transition includes
      // real durable I/O rather than the no-op guest-to-guest fast path.
      await tester.runAsync(() async {
        await store.activateAccount('previous-account');
        await store.write(
          'pace.profile.name',
          'previous account only',
          enqueueSync: false,
        );
      });

      await tester.pumpWidget(
        MaterialApp(
          home: PaceApp(
            localStore: store,
            auth: auth,
            sync: SyncService(localStore: store, client: null),
          ),
        ),
      );
      expect(find.text('Continuer hors connexion'), findsOneWidget);

      await tester.tap(find.text('Continuer hors connexion'));
      // Emit immediately after the tap, while activateAccount(null) is queued
      // but before the guest shell has been shown.
      auth.emitSignedOut();

      for (var attempt = 0;
          attempt < 20 && find.text('Se connecter').evaluate().isEmpty;
          attempt++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 100)),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 50));
      }

      expect(find.text('Se connecter'), findsOneWidget);
      expect(find.byType(NavigationBar), findsNothing);
      expect(store.activeUserId, isNull);
      expect(store.read('pace.profile.name'), isNull);
    },
    timeout: const Timeout(Duration(seconds: 45)),
  );

  testWidgets(
    'offline mode can return to the auth screen without a session',
    (tester) async {
      final directory = await tester.runAsync(
        () => Directory.systemTemp.createTemp('pace-offline-exit-'),
      );
      if (directory == null) throw StateError('Could not create test directory');
      debugPrint('offline-stage: temp directory created');
      final store = await tester.runAsync(() => LocalStore.open(directory: directory));
      if (store == null) throw StateError('Could not open test local store');
      debugPrint('offline-stage: store opened');
      addTearDown(() async {
        store.dispose();
        await tester.runAsync(() => directory.delete(recursive: true));
      });

      debugPrint('offline-stage: before pumpWidget');
      await tester.pumpWidget(
        MaterialApp(
          home: PaceApp(
            localStore: store,
            auth: const PaceAuthService(null),
            sync: SyncService(localStore: store, client: null),
          ),
        ),
      );

      final offlineButton = find.text('Continuer hors connexion');
      expect(offlineButton, findsOneWidget);
      debugPrint('offline-stage: auth screen shown');
      await tester.tap(offlineButton);
      // _continueOffline activates the guest scope asynchronously. Poll for
      // the actual shell instead of assuming a fixed delay is sufficient on
      // slower CI runners; runAsync lets file I/O finish outside fake-async.
      final navigationBar = find.byType(NavigationBar);
      for (var attempt = 0;
          attempt < 20 && navigationBar.evaluate().isEmpty;
          attempt++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 100)),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 50));
      }
      expect(navigationBar, findsOneWidget);
      await tester.pump(const Duration(milliseconds: 300));
      debugPrint('offline-stage: local shell shown');

      // The shell's exit action is in the Plus section, not on the initial tab.
      final navTopLeft = tester.getTopLeft(navigationBar);
      final navSize = tester.getSize(navigationBar);
      await tester.tapAt(
        navTopLeft + Offset(navSize.width * 0.9, navSize.height * 0.5),
      );
      await tester.pump();
      expect(find.text('Revenir à la connexion'), findsOneWidget);
      debugPrint('offline-stage: exit button shown');

      await tester.tap(find.text('Revenir à la connexion'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.text('Se connecter'), findsOneWidget);
      expect(find.text('Continuer hors connexion'), findsOneWidget);
      debugPrint('offline-stage: returned to auth');
    },
    timeout: const Timeout(Duration(seconds: 45)),
  );
}

class _EventSessionAuthService extends PaceAuthService {
  _EventSessionAuthService()
      : super(
          SupabaseClient(
            'https://example.supabase.co',
            'test-anon-key',
            authOptions: const AuthClientOptions(autoRefreshToken: false),
          ),
        );

  final StreamController<AuthState> _events =
      StreamController<AuthState>.broadcast();

  @override
  User? get currentUser => null;

  @override
  Stream<AuthState> get authStateChanges => _events.stream;

  void emitSignedOut() {
    _events.add(AuthState(AuthChangeEvent.signedOut, null));
  }

  Future<void> closeEvents() => _events.close();
}

class _MutableSessionAuthService extends PaceAuthService {
  _MutableSessionAuthService() : super(null);

  User? activeUser;

  @override
  User? get currentUser => activeUser;

  @override
  Stream<AuthState> get authStateChanges => const Stream<AuthState>.empty();
}
