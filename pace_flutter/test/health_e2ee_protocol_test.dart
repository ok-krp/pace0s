import 'dart:convert';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:unorm_dart/unorm_dart.dart' as unorm;

import 'package:pace/core/security/health_aes_key_wrap.dart';

void main() {
  test('RFC 3394 AES-256 vector is compatible with the protocol', () {
    final kek = List<int>.generate(32, (i) => i);
    final plaintext = List<int>.generate(16, (i) => i);
    final expected = <int>[
      0x8c, 0xc4, 0xbf, 0xec, 0xa8, 0xa9, 0xf2, 0x38,
      0xc8, 0xb2, 0x83, 0x92, 0x1e, 0xf8, 0x4b, 0x3e,
      0x5a, 0x5f, 0xd2, 0xf2, 0x0b, 0xd6, 0x88,
    ];
    final wrapped = AesKeyWrap.wrap(kek, plaintext);
    expect(wrapped, expected);
    expect(AesKeyWrap.unwrap(kek, wrapped), plaintext);
  });

  test('tampered AES-KW integrity register is rejected', () {
    final kek = List<int>.generate(32, (i) => i);
    final plaintext = List<int>.generate(32, (i) => i + 1);
    final wrapped = AesKeyWrap.wrap(kek, plaintext);
    wrapped[0] ^= 1;
    expect(() => AesKeyWrap.unwrap(kek, wrapped), throwsStateError);
  });

  test('AES-256-GCM ciphertext + 16-byte tag round-trips', () async {
    final aes = AesGcm.with256bits();
    final key = List<int>.generate(32, (i) => i);
    final plaintext = utf8.encode(
      jsonEncode({
        'ts': '2026-01-02T03:04:05.000Z',
        'type': 'heart_rate',
        'value': 72.0,
        'source': 'HealthKit',
      }),
    );

    final box = await aes.encrypt(
      plaintext,
      secretKey: SecretKeyData(key),
      nonce: List<int>.generate(12, (i) => i + 1),
    );

    expect(box.nonce.length, 12);
    expect(box.mac.bytes.length, 16);
    expect(
      await aes.decrypt(box, secretKey: SecretKeyData(key)),
      plaintext,
    );
  });

  test('HKDF and NFC/HMAC dedupe vector matches the Web protocol', () async {
    final master = List<int>.generate(32, (i) => i);
    final root = await Hkdf(
      hmac: Hmac.sha256(),
      outputLength: 32,
    ).deriveKey(
      secretKey: SecretKeyData(master),
      nonce: utf8.encode('paceos-health-e2ee-dedupe-v1'),
      info: utf8.encode('paceos/health/dedupe-hmac-sha256/v1'),
    );
    final rootBytes = await root.extractBytes();

    expect(
      _hex(rootBytes),
      'a446c5456b49ac4a52b9a88e24b8e35ada6ad9e14044070b72d5bafab6e4e548',
    );

    final canonical = jsonEncode([
      unorm.nfc('heart_rate'),
      DateTime.parse('2026-01-02T03:04:05.000Z').toUtc().toIso8601String(),
      unorm.nfc('HealthKit'),
      unorm.nfc('external-α'),
    ]);
    final mac = await Hmac.sha256().calculateMac(
      utf8.encode(canonical),
      secretKey: SecretKeyData(rootBytes),
    );

    expect(
      _hex(mac.bytes),
      'abac55a54e12eef14b01a5319db1d476e8fd9b5f4148e4b7deee97fff9421f2a',
    );
  });
}

String _hex(List<int> bytes) =>
    bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
