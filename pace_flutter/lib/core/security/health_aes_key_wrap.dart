import 'dart:typed_data';

import 'package:pointycastle/export.dart';

class AesKeyWrap {
  AesKeyWrap._();

  static final _iv = Uint8List.fromList(
    const [0xA6, 0xA6, 0xA6, 0xA6, 0xA6, 0xA6, 0xA6, 0xA6],
  );

  static Uint8List wrap(List<int> kek, List<int> plaintext) {
    _validate(kek, plaintext, minimum: 16);
    final n = plaintext.length ~/ 8;
    final a = Uint8List.fromList(_iv);
    final r = List<Uint8List>.generate(
      n,
      (i) => Uint8List.fromList(plaintext.sublist(i * 8, (i + 1) * 8)),
    );
    final cipher = _cipher(kek, true);
    for (var j = 0; j < 6; j++) {
      for (var i = 0; i < n; i++) {
        final input = Uint8List(16)
          ..setRange(0, 8, a)
          ..setRange(8, 16, r[i]);
        final block = cipher.process(input);
        final nextA = Uint8List.fromList(block.sublist(0, 8));
        _xor(nextA, n * j + i + 1);
        a.setRange(0, 8, nextA);
        r[i] = Uint8List.fromList(block.sublist(8, 16));
      }
    }
    final output = Uint8List(8 + plaintext.length)..setRange(0, 8, a);
    for (var i = 0; i < n; i++) {
      output.setRange(8 + i * 8, 16 + i * 8, r[i]);
    }
    return output;
  }

  static Uint8List unwrap(List<int> kek, List<int> wrapped) {
    _validate(kek, wrapped, minimum: 24);
    final n = wrapped.length ~/ 8 - 1;
    var a = Uint8List.fromList(wrapped.sublist(0, 8));
    final r = List<Uint8List>.generate(
      n,
      (i) => Uint8List.fromList(wrapped.sublist(8 + i * 8, 16 + i * 8)),
    );
    final cipher = _cipher(kek, false);
    for (var j = 5; j >= 0; j--) {
      for (var i = n - 1; i >= 0; i--) {
        final inputA = Uint8List.fromList(a);
        _xor(inputA, n * j + i + 1);
        final input = Uint8List(16)
          ..setRange(0, 8, inputA)
          ..setRange(8, 16, r[i]);
        final block = cipher.process(input);
        a = Uint8List.fromList(block.sublist(0, 8));
        r[i] = Uint8List.fromList(block.sublist(8, 16));
      }
    }
    if (!_equal(a, _iv)) {
      throw StateError('AES-KW integrity check failed.');
    }
    final output = Uint8List(wrapped.length - 8);
    for (var i = 0; i < n; i++) {
      output.setRange(i * 8, (i + 1) * 8, r[i]);
    }
    return output;
  }

  static BlockCipher _cipher(List<int> key, bool encrypt) =>
      AESEngine()..init(encrypt, KeyParameter(Uint8List.fromList(key)));

  static void _validate(List<int> kek, List<int> data, {required int minimum}) {
    if (kek.length != 32) {
      throw ArgumentError('AES-256-KW KEK must be 32 bytes.');
    }
    if (data.length < minimum || data.length % 8 != 0) {
      throw ArgumentError('AES-KW data must be 8-byte aligned.');
    }
  }

  static void _xor(Uint8List value, int t) {
    for (var i = 7; i >= 0 && t != 0; i--) {
      value[i] ^= t & 0xff;
      t >>= 8;
    }
  }

  static bool _equal(List<int> a, List<int> b) {
    if (a.length != b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) {
      diff |= a[i] ^ b[i];
    }
    return diff == 0;
  }
}
