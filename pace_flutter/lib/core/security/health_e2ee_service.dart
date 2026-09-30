import 'dart:convert';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:unorm_dart/unorm_dart.dart' as unorm;

import '../platform/health_adapter.dart';
import 'health_aes_key_wrap.dart';

class HealthE2eeService {
  HealthE2eeService({required this.client, FlutterSecureStorage? secureStorage})
      : _secureStorage = secureStorage ?? const FlutterSecureStorage();

  static const _algorithm = 'AES-256-GCM';
  static const _deviceAlgorithm = 'ECDH-P256';
  static const _deviceKey = 'pace.health.e2ee.device.jwk.v1';
  static const _deviceIdKey = 'pace.health.e2ee.device.id.v1';
  static const _masterPrefix = 'pace.health.e2ee.master.v';
  static const _dedupeKey = 'pace.health.e2ee.dedupe-root.v1';
  static const _versionKey = 'pace.health.e2ee.current-version.v1';
  static const _dedupeSalt = 'paceos-health-e2ee-dedupe-v1';
  static const _dedupeInfo = 'paceos/health/dedupe-hmac-sha256/v1';

  final SupabaseClient client;
  final FlutterSecureStorage _secureStorage;
  final AesGcm _aes = AesGcm.with256bits();
  final Ecdh _ecdh = Ecdh.p256(length: 32);
  final Hmac _hmac = Hmac.sha256();

  String _userId() {
    final id = client.auth.currentUser?.id;
    if (id == null) throw StateError('Un compte connecté est requis.');
    return id;
  }

  Future<int> currentKeyVersion() async {
    final cached = await _secureStorage.read(key: _versionKey);
    if (cached != null) return int.parse(cached);
    final row = await client.from('health_e2ee_key_versions').select('current_key_version').eq('user_id', _userId()).maybeSingle();
    final version = row == null ? 1 : int.parse(row['current_key_version'].toString());
    await _secureStorage.write(key: _versionKey, value: version.toString());
    return version;
  }

  Future<void> ensureInitialized({String deviceName = 'Pace Flutter'}) async {
    final version = await currentKeyVersion();
    await ensureRegisteredDevice(deviceName: deviceName);

    if (await _readMasterKey(version) != null) {
      if (await _secureStorage.read(key: _dedupeKey) == null) {
        await _dedupeRootKey();
      }
      return;
    }

    await acceptPendingKeyEnvelopes();
    if (await _readMasterKey(version) != null) {
      return;
    }

    final devices = await client
        .from('health_e2ee_devices')
        .select('id')
        .eq('user_id', _userId())
        .isFilter('revoked_at', null);

    if (devices.length == 1) {
      await _masterKey(version);
      await _dedupeRootKey();
      return;
    }

    throw StateError(
      'Health E2EE key provisioning is required before this device can use health sync.',
    );
  }

  Future<String> ensureRegisteredDevice({String deviceName = 'Pace Flutter'}) async {
    final existing = await _secureStorage.read(key: _deviceIdKey);
    if (existing != null && existing.isNotEmpty) return existing;
    final row = await client.from('health_e2ee_devices').insert({
      'user_id': _userId(),
      'device_name': deviceName,
      'public_key': await devicePublicKey(),
      'algorithm': _deviceAlgorithm,
    }).select('id').single();
    final id = row['id'] as String;
    await _secureStorage.write(key: _deviceIdKey, value: id);
    return id;
  }

  Future<String?> registeredDeviceId() => _secureStorage.read(key: _deviceIdKey);

  Future<Map<String, dynamic>> devicePublicKey() async {
    final data = await (await _deviceKeyPair()).extract();
    if (data is! EcKeyPairData) throw StateError('Invalid persisted P-256 device key.');
    return {'kty': 'EC', 'crv': 'P-256', 'x': _b64Url(data.x), 'y': _b64Url(data.y)};
  }

  Future<int> acceptPendingKeyEnvelopes() async {
    final deviceId = await registeredDeviceId();
    if (deviceId == null) throw StateError('Flutter health device is not registered.');

    final envelopes = await client.from('health_e2ee_key_envelopes')
        .select('device_id,sender_device_id,envelope,nonce,algorithm,key_version')
        .eq('user_id', _userId()).eq('device_id', deviceId).order('created_at', ascending: false);

    final senderIds = envelopes.map((r) => r['sender_device_id']).whereType<String>().toSet().toList();
    if (senderIds.isEmpty) return currentKeyVersion();

    final devices = await client.from('health_e2ee_devices')
        .select('id,public_key,revoked_at').eq('user_id', _userId()).inFilter('id', senderIds);
    final byId = <String, Map<String, dynamic>>{
      for (final r in devices) r['id'] as String: Map<String, dynamic>.from(r),
    };

    var highest = await currentKeyVersion();
    for (final raw in envelopes) {
      final row = Map<String, dynamic>.from(raw);
      final senderId = row['sender_device_id'] as String?;
      final sender = senderId == null ? null : byId[senderId];
      if (sender == null || sender['revoked_at'] != null || senderId == null) continue;

      final version = int.parse(row['key_version'].toString());
      final publicKey = Map<String, dynamic>.from(sender['public_key'] as Map);
      final algorithm = row['algorithm'] as String;

      if (algorithm == 'ECDH-P256/AES-256-GCM') {
        await _unwrapGcmEnvelope(
          ciphertext: row['envelope'] as String,
          nonce: row['nonce'] as String,
          senderPublicKey: publicKey,
          deviceId: deviceId,
          senderDeviceId: senderId,
          keyVersion: version,
        );
      } else if (algorithm == 'ECDH-P256/AES-256-KW') {
        final shared = await _sharedSecret(publicKey);
        final rawKey = AesKeyWrap.unwrap(await shared.extractBytes(), base64Decode(row['envelope'] as String));
        await _storeMasterKey(version, rawKey);
      } else if (algorithm == 'ECDH-P256/AES-256-KW/KEY-BUNDLE-V1') {
        final bundle = jsonDecode(row['envelope'] as String);
        if (bundle is! Map<String, dynamic>) continue;
        final shared = await _sharedSecret(publicKey);
        final kek = await shared.extractBytes();
        final masterNode = bundle['health_master_key'];
        final dedupeNode = bundle['dedupe_root_key'];
        if (masterNode is! Map || dedupeNode is! Map) continue;
        final bundleVersion = int.parse(masterNode['key_version'].toString());
        await _storeMasterKey(bundleVersion, AesKeyWrap.unwrap(kek, _b64UrlDecode(masterNode['wrapped_key'] as String)));
        await _storeDedupeRootKey(AesKeyWrap.unwrap(kek, _b64UrlDecode(dedupeNode['wrapped_key'] as String)));
        if (bundleVersion > highest) highest = bundleVersion;
      }
      if (version > highest) highest = version;
    }

    await _secureStorage.write(key: _versionKey, value: highest.toString());
    return highest;
  }

  Future<List<Map<String, dynamic>>> pullAndDecryptSamples({int limit = 10000}) async {
    await ensureInitialized();
    await acceptPendingKeyEnvelopes();

    final rows = await client.from('health_samples_e2ee')
        .select('id,ciphertext,nonce,algorithm,key_version,created_at,dedupe_hash')
        .eq('user_id', _userId()).order('created_at', ascending: false).limit(limit);

    final result = <Map<String, dynamic>>[];
    for (final raw in rows) {
      final row = Map<String, dynamic>.from(raw);
      if (row['algorithm'] != _algorithm) continue;
      final key = await _readMasterKey(int.parse(row['key_version'].toString()));
      if (key == null) continue;
      final packed = base64Decode(row['ciphertext'] as String);
      if (packed.length < 16) continue;
      final box = SecretBox(
        packed.sublist(0, packed.length - 16),
        nonce: base64Decode(row['nonce'] as String),
        mac: Mac(packed.sublist(packed.length - 16)),
      );
      final plaintext = await _aes.decrypt(box, secretKey: SecretKeyData(key));
      final value = jsonDecode(utf8.decode(plaintext));
      if (value is Map<String, dynamic>) result.add({'id': row['id'], ...value, 'created_at': row['created_at']});
    }
    return result;
  }

  Future<int> uploadSamples(List<PaceHealthSample> samples) async {
    if (samples.isEmpty) return 0;
    await ensureInitialized();
    await acceptPendingKeyEnvelopes();

    final version = await currentKeyVersion();
    final master = await _masterKey(version);
    final dedupeRoot = await _dedupeRootKey();
    final records = <Map<String, dynamic>>[];

    for (final sample in samples) {
      if (!sample.value.isFinite) throw ArgumentError('Health sample value must be finite.');
      final timestamp = sample.timestamp.toUtc().toIso8601String();
      final source = sample.source ?? 'manual';
      final externalId = '$source|${sample.type}|' +
          sample.timestamp.toUtc().microsecondsSinceEpoch.toString() + '|' +
          sample.value.toString() + '|' + (sample.unit ?? '');

      final canonical = jsonEncode([
        unorm.nfc(sample.type),
        DateTime.parse(timestamp).toUtc().toIso8601String(),
        unorm.nfc(source),
        unorm.nfc(externalId),
      ]);
      final mac = await _hmac.calculateMac(utf8.encode(canonical), secretKey: SecretKeyData(dedupeRoot));
      final box = await _aes.encrypt(
        utf8.encode(jsonEncode({
          'ts': timestamp,
          'type': sample.type,
          'value': sample.value,
          'source': source,
          'external_id': externalId,
          'metadata': {if (sample.unit != null) 'unit': sample.unit},
        })),
        secretKey: SecretKeyData(master),
      );

      records.add({
        'user_id': _userId(),
        'ciphertext': base64Encode([...box.cipherText, ...box.mac.bytes]),
        'nonce': base64Encode(box.nonce),
        'algorithm': _algorithm,
        'key_version': version,
        'dedupe_hash': _hex(mac.bytes),
      });
    }

    await client.from('health_samples_e2ee').upsert(records, onConflict: 'user_id,dedupe_hash');
    return records.length;
  }

  Future<Map<String, dynamic>> createKeyBundleForDevice({
    required String targetDeviceId,
    required Map<String, dynamic> targetPublicKey,
  }) async {
    final senderDeviceId = await ensureRegisteredDevice();
    final version = await currentKeyVersion();
    final shared = await _sharedSecret(targetPublicKey);
    final kek = await shared.extractBytes();
    final bundle = {
      'version': 1,
      'health_master_key': {
        'wrapped_key': _b64Url(AesKeyWrap.wrap(kek, await _masterKey(version))),
        'key_version': version,
      },
      'dedupe_root_key': {
        'wrapped_key': _b64Url(AesKeyWrap.wrap(kek, await _dedupeRootKey())),
      },
    };

    await client.from('health_e2ee_key_envelopes').insert({
      'user_id': _userId(),
      'device_id': targetDeviceId,
      'sender_device_id': senderDeviceId,
      'envelope': jsonEncode(bundle),
      'nonce': null,
      'algorithm': 'ECDH-P256/AES-256-KW/KEY-BUNDLE-V1',
      'key_version': version,
    });
    return bundle;
  }

  Future<KeyPair> _deviceKeyPair() async {
    final encoded = await _secureStorage.read(key: _deviceKey);
    if (encoded != null) {
      final value = jsonDecode(encoded) as Map<String, dynamic>;
      return EcKeyPairData(
        d: _b64UrlDecode(value['d'] as String),
        x: _b64UrlDecode(value['x'] as String),
        y: _b64UrlDecode(value['y'] as String),
        type: KeyPairType.p256,
        debugLabel: 'Pace health E2EE device key',
      );
    }

    final pair = await _ecdh.newKeyPair();
    final data = await pair.extract();
    await _secureStorage.write(
      key: _deviceKey,
      value: jsonEncode({'kty': 'EC', 'crv': 'P-256', 'd': _b64Url(data.d), 'x': _b64Url(data.x), 'y': _b64Url(data.y)}),
      aOptions: const AndroidOptions(encryptedSharedPreferences: true),
    );
    return pair;
  }

  Future<SecretKey> _sharedSecret(Map<String, dynamic> publicKey) async {
    final remote = EcPublicKey(
      x: _b64UrlDecode(publicKey['x'] as String),
      y: _b64UrlDecode(publicKey['y'] as String),
      type: KeyPairType.p256,
    );
    return _ecdh.sharedSecretKey(keyPair: await _deviceKeyPair(), remotePublicKey: remote);
  }

  Future<void> _unwrapGcmEnvelope({
    required String ciphertext,
    required String nonce,
    required Map<String, dynamic> senderPublicKey,
    required String deviceId,
    required String senderDeviceId,
    required int keyVersion,
  }) async {
    final shared = await _sharedSecret(senderPublicKey);
    final packed = base64Decode(ciphertext);
    if (packed.length < 16) throw StateError('Invalid health E2EE envelope.');
    final box = SecretBox(
      packed.sublist(0, packed.length - 16),
      nonce: base64Decode(nonce),
      mac: Mac(packed.sublist(packed.length - 16)),
    );
    final aad = utf8.encode(
      'pace-health-e2ee|device=$deviceId|sender=$senderDeviceId|v=$keyVersion',
    );
    await _storeMasterKey(keyVersion, await _aes.decrypt(box, secretKey: shared, aad: aad));
  }

  Future<List<int>> _masterKey(int version) async {
    final existing = await _readMasterKey(version);
    if (existing != null) return existing;
    final generated = await _aes.newSecretKey();
    final bytes = await generated.extractBytes();
    await _storeMasterKey(version, bytes);
    return bytes;
  }

  Future<List<int>> _dedupeRootKey() async {
    final existing = await _secureStorage.read(key: _dedupeKey);
    if (existing != null) return base64Decode(existing);
    final master = await _masterKey(1);
    final root = await Hkdf(hmac: Hmac.sha256(), outputLength: 32).deriveKey(
      secretKey: SecretKeyData(master),
      nonce: utf8.encode(_dedupeSalt),
      info: utf8.encode(_dedupeInfo),
    );
    final bytes = await root.extractBytes();
    await _storeDedupeRootKey(bytes);
    return bytes;
  }

  Future<List<int>?> _readMasterKey(int version) async {
    final value = await _secureStorage.read(key: _masterPrefix + version.toString());
    return value == null ? null : base64Decode(value);
  }

  Future<void> _storeMasterKey(int version, List<int> bytes) async {
    if (bytes.length != 32) throw StateError('Health Master Key must be 256 bits.');
    await _secureStorage.write(
      key: _masterPrefix + version.toString(),
      value: base64Encode(bytes),
      aOptions: const AndroidOptions(encryptedSharedPreferences: true),
    );
  }

  Future<void> _storeDedupeRootKey(List<int> bytes) async {
    if (bytes.length != 32) throw StateError('Dedupe Root Key must be 256 bits.');
    await _secureStorage.write(key: _dedupeKey, value: base64Encode(bytes));
  }

  static String _hex(List<int> bytes) =>\n      bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  static String _b64Url(List<int> bytes) => base64Url.encode(bytes).replaceAll('=', '');
  static List<int> _b64UrlDecode(String value) {
    final normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    return base64Decode(normalized.padRight((normalized.length + 3) ~/ 4 * 4, '='));
  }
}
