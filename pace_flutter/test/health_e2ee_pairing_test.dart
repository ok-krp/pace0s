import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'package:pace/core/security/health_e2ee_pairing.dart';
import 'package:pace/core/security/health_e2ee_service.dart';

void main() {
  test('pairing HKDF context and SAS match the Web protocol vector', () async {
    final client = SupabaseClient('https://example.invalid', 'anon');
    final service = HealthE2eeService(client: client);
    final pairing = HealthE2eePairing(client: client, healthE2ee: service);
    final sender = {
      'kty': 'EC',
      'crv': 'P-256',
      'x': 'x',
      'y': 'y',
    };
    final recipient = {
      'kty': 'EC',
      'crv': 'P-256',
      'x': 'u',
      'y': 'v',
    };
    final context = HealthPairingContext(
      sessionId: '00000000-0000-0000-0000-000000000001',
      challenge: 'challenge',
      senderDeviceId: '00000000-0000-0000-0000-000000000002',
      recipientDeviceId: '00000000-0000-0000-0000-000000000003',
      keyVersion: 1,
      senderEphemeralPublicKey: sender,
      recipientEphemeralPublicKey: recipient,
    );
    final shared = List<int>.generate(32, (i) => i);

    final wrap = await pairing.derivePairingBits(
      sharedSecret: shared,
      context: context,
      purpose: 'wrap',
    );
    expect(
      _hex(wrap),
      'f25e983db5136bae11f78f5e7ea4b854b9b949858cc98c41327c6146f988dea7',
    );

    final sas = await pairing.derivePairingSasFromSharedSecret(
      sharedSecret: shared,
      context: context,
    );
    expect(sas, '285-396-110');

    final expectedContext = jsonEncode([
      'pace-health-pairing-v1',
      context.sessionId,
      context.challenge,
      context.senderDeviceId,
      context.recipientDeviceId,
      1,
      jsonEncode({'crv': 'P-256', 'kty': 'EC', 'x': 'x', 'y': 'y'}),
      jsonEncode({'crv': 'P-256', 'kty': 'EC', 'x': 'u', 'y': 'v'}),
    ]);
    expect(utf8.decode(context.contextBytes()), expectedContext);
  });
}

String _hex(List<int> bytes) =>
    bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
