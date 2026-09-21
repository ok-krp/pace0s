import 'dart:convert';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'health_adapter.dart';

class HealthE2eeService {
  HealthE2eeService({required this.client, FlutterSecureStorage? secureStorage})
      : _secureStorage = secureStorage ?? const FlutterSecureStorage();

  static const _keyName = 'pace.health.e2ee.key.v1';
  static const _algorithm = 'AES-256-GCM';

  final SupabaseClient client;
  final FlutterSecureStorage _secureStorage;
  final AesGcm _aes = AesGcm.with256bits();

  Future<SecretKey> _getOrCreateKey() async {
    final encoded = await _secureStorage.read(key: _keyName);
    if (encoded != null && encoded.isNotEmpty) return SecretKey(base64Decode(encoded));
    final key = await _aes.newSecretKey();
    final bytes = await key.extractBytes();
    await _secureStorage.write(key: _keyName, value: base64Encode(bytes), aOptions: const AndroidOptions(encryptedSharedPreferences: true));
    return key;
  }

  Future<List<Map<String, String>>> encryptSamples(List<PaceHealthSample> samples) async {
    final key = await _getOrCreateKey();
    final records = <Map<String, String>>[];
    for (final sample in samples) {
      final payload = utf8.encode(jsonEncode({
        'type': sample.type, 'value': sample.value,
        'timestamp': sample.timestamp.toUtc().toIso8601String(),
        'unit': sample.unit, 'source': sample.source,
      }));
      final nonce = _aes.newNonce();
      final box = await _aes.encrypt(payload, secretKey: key, nonce: nonce);
      records.add({'ciphertext': base64Encode(box.cipherText), 'nonce': base64Encode(box.nonce), 'algorithm': _algorithm, 'key_version': '1'});
    }
    return records;
  }

  Future<int> uploadSamples(List<PaceHealthSample> samples) async {
    if (samples.isEmpty) return 0;
    final user = client.auth.currentUser;
    if (user == null) throw StateError('Un compte connecté est requis.');
    final encrypted = await encryptSamples(samples);
    final rows = encrypted.map((record) => <String, dynamic>{
      ...record, 'user_id': user.id, 'key_version': int.parse(record['key_version']!),
    }).toList();
    await client.from('health_samples_e2ee').insert(rows);
    return rows.length;
  }

  Future<void> deleteLocalKey() => _secureStorage.delete(
    key: _keyName,
    aOptions: const AndroidOptions(encryptedSharedPreferences: true),
  );
}
