import 'package:flutter_test/flutter_test.dart';

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
}
