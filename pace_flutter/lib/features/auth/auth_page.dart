import 'package:flutter/material.dart';

import '../../core/supabase/pace_supabase.dart';

class AuthPage extends StatefulWidget {
  const AuthPage({super.key, required this.auth});

  final PaceAuthService auth;

  @override
  State<AuthPage> createState() => _AuthPageState();
}

class _AuthPageState extends State<AuthPage> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _createAccount = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (_createAccount) {
        await widget.auth.signUp(email: _email.text.trim(), password: _password.text);
      } else {
        await widget.auth.signInWithPassword(email: _email.text.trim(), password: _password.text);
      }
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('Pace', style: Theme.of(context).textTheme.headlineMedium),
                    const SizedBox(height: 8),
                    Text(_createAccount ? 'Créer un compte' : 'Connexion'),
                    const SizedBox(height: 20),
                    TextField(controller: _email, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'E-mail')),
                    const SizedBox(height: 12),
                    TextField(controller: _password, obscureText: true, decoration: const InputDecoration(labelText: 'Mot de passe')),
                    if (_error != null) ...[
                      const SizedBox(height: 12),
                      Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                    ],
                    const SizedBox(height: 20),
                    FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'Connexion…' : (_createAccount ? 'Créer le compte' : 'Se connecter'))),
                    TextButton(onPressed: _busy ? null : () => setState(() => _createAccount = !_createAccount), child: Text(_createAccount ? 'J’ai déjà un compte' : 'Créer un compte')),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
