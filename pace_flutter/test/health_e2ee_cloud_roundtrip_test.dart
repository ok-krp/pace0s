import 'dart:convert';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:pace/core/security/health_aes_key_wrap.dart';

void main() {
  final aes = AesGcm.with256bits();
  final ecdh = Ecdh.p256(length: 32);

  test('P0.4: Health A -> cloud ciphertext -> Health B decrypts the same sample', () async {
    final healthMasterKey = await aes.newSecretKey();
    final plaintext = utf8.encode(jsonEncode({
      'ts': '2026-10-01T07:30:00.000Z',
      'type': 'heart_rate',
      'value': 72.0,
      'source': 'health_connect',
      'external_id': 'hc-heart-rate-001',
    }));

    // Device A encrypts before anything is sent to the cloud.
    final box = await aes.encrypt(
      plaintext,
      secretKey: healthMasterKey,
      nonce: List<int>.generate(12, (index) => index + 1),
    );

    final cloudRecord = <String, dynamic>{
      'ciphertext': base64Encode([...box.cipherText, ...box.mac.bytes]),
      'nonce': base64Encode(box.nonce),
      'algorithm': 'AES-256-GCM',
      'key_version': 1,
      'dedupe_hash': '0' * 64,
    };

    // The cloud representation is opaque: no plaintext health field is stored.
    final cloudJson = jsonEncode(cloudRecord);
    expect(cloudJson, isNot(contains('heart_rate')));
    expect(cloudJson, isNot(contains('72.0')));
    expect(cloudRecord['algorithm'], 'AES-256-GCM');
    expect(cloudRecord['key_version'], 1);

    // Device B already owns the same Health Master Key after E2EE pairing.
    final packed = base64Decode(cloudRecord['ciphertext'] as String);
    final decrypted = await aes.decrypt(
      SecretBox(
        packed.sublist(0, packed.length - 16),
        nonce: base64Decode(cloudRecord['nonce'] as String),
        mac: Mac(packed.sublist(packed.length - 16)),
      ),
      secretKey: healthMasterKey,
    );

    expect(jsonDecode(utf8.decode(decrypted)), jsonDecode(utf8.decode(plaintext)));
  });

  test('P0.4: Health A transfers the master key to B through ECDH P-256 + AES-KW', () async {
    final healthMasterKey = await aes.newSecretKey();
    final masterBytes = await healthMasterKey.extractBytes();

    final sender = await ecdh.newKeyPair();
    final recipient = await ecdh.newKeyPair();

    final senderShared = await ecdh.sharedSecretKey(
      keyPair: sender,
      remotePublicKey: await recipient.extractPublicKey(),
    );
    final recipientShared = await ecdh.sharedSecretKey(
      keyPair: recipient,
      remotePublicKey: await sender.extractPublicKey(),
    );

    final wrapped = AesKeyWrap.wrap(
      await senderShared.extractBytes(),
      masterBytes,
    );
    final unwrapped = AesKeyWrap.unwrap(
      await recipientShared.extractBytes(),
      wrapped,
    );

    expect(unwrapped, masterBytes);
  });

  test('P0.4: a tampered cloud ciphertext cannot be decrypted by Health B', () async {
    final key = await aes.newSecretKey();
    final box = await aes.encrypt(
      utf8.encode('health-secret'),
      secretKey: key,
      nonce: List<int>.generate(12, (index) => index + 1),
    );

    final tamperedCiphertext = [...box.cipherText, ...box.mac.bytes];
    tamperedCiphertext[0] ^= 1;

    expect(
      () => aes.decrypt(
        SecretBox(
          tamperedCiphertext.sublist(0, tamperedCiphertext.length - 16),
          nonce: box.nonce,
          mac: Mac(tamperedCiphertext.sublist(tamperedCiphertext.length - 16)),
        ),
        secretKey: key,
      ),
      throwsA(anything),
    );
  });
}
