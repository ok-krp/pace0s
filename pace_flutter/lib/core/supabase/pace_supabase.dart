import 'package:supabase_flutter/supabase_flutter.dart';

class PaceSupabase {
  PaceSupabase._();

  static SupabaseClient? _client;

  static Future<SupabaseClient?> initialize() async {
    final url = const String.fromEnvironment('SUPABASE_URL');
    final key = const String.fromEnvironment('SUPABASE_PUBLISHABLE_KEY', defaultValue: String.fromEnvironment('SUPABASE_ANON_KEY'));
    if (url.isEmpty || key.isEmpty) return null;
    await Supabase.initialize(
      url: url,
      publishableKey: key,
      authOptions: const FlutterAuthClientOptions(autoRefreshToken: true),
    );
    _client = Supabase.instance.client;
    return _client;
  }

  static SupabaseClient? get client => _client;
}

class PaceAuthService {
  const PaceAuthService(this.client);
  final SupabaseClient? client;

  User? get currentUser => client?.auth.currentUser;

  Stream<AuthState> get authStateChanges => client?.auth.onAuthStateChange ?? const Stream<AuthState>.empty();

  Future<AuthResponse> signInWithPassword({required String email, required String password}) async {
    final value = client;
    if (value == null) throw StateError('Supabase is not configured.');
    return value.auth.signInWithPassword(email: email, password: password);
  }

  Future<AuthResponse> signUp({required String email, required String password}) async {
    final value = client;
    if (value == null) throw StateError('Supabase is not configured.');
    return value.auth.signUp(email: email, password: password);
  }

  Future<void> signOut() async {
    await client?.auth.signOut();
  }
}
