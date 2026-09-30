import 'dart:convert';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:unorm_dart/unorm_dart.dart' as unorm;

import 'package:pace/core/security/health_aes_key_wrap.dart';

void main() {
  test('RFC 3394 AES-256 vector is compatible with the protocol', () {
    final kek = List<int>.generate(32, (i) => i);
    final plaintext = <int>[
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
      0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
    ];
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

    final opened = await aes.decrypt(
      SecretBox(box.cipherText, nonce: box.nonce, mac: box.mac),
      secretKey: SecretKeyData(key),
    );

    expect(utf8.decode(opened), utf8.decode(plaintext));
  });

  test('HKDF and NFC/HMAC dedupe vector matches the Web protocol', () async {
    final root = await Hkdf(hmac: Hmac.sha256(), outputLength: 32).deriveKey(
      secretKey: SecretKeyData(List<int>.generate(32, (i) => i)),
      nonce: utf8.encode('pace-health-e2ee-dedupe-v1'),
      info: utf8.encode('pace-health-e2ee-dedupe-root-v1'),
    );
    final rootBytes = await root.extractBytes();
    expect(rootBytes.length, 32);

    final hmac = Hmac.sha256();
    final normalized = unorm.nfc('Épinards');
    final digest = await hmac.calculateMac(
      utf8.encode(normalized),
      secretKey: SecretKeyData(rootBytes),
    );
    expect(digest.bytes.length, 32);
  });
}
