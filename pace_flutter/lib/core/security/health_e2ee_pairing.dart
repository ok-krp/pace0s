import 'dart:convert';
import 'dart:math';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:unorm_dart/unorm_dart.dart' as unorm;

import 'health_aes_key_wrap.dart';
import 'health_e2ee_service.dart';

class HealthPairingContext {
  const HealthPairingContext({required this.sessionId, required this.challenge, required this.senderDeviceId, required this.recipientDeviceId, required this.keyVersion, required this.senderEphemeralPublicKey, required this.recipientEphemeralPublicKey});
  final String sessionId, challenge, senderDeviceId, recipientDeviceId;
  final int keyVersion;
  final Map<String, dynamic> senderEphemeralPublicKey, recipientEphemeralPublicKey;
  List<int> contextBytes() => utf8.encode(jsonEncode(['pace-health-pairing-v1', unorm.nfc(sessionId), unorm.nfc(challenge), unorm.nfc(senderDeviceId), unorm.nfc(recipientDeviceId), keyVersion, _canonicalPublicKey(senderEphemeralPublicKey), _canonicalPublicKey(recipientEphemeralPublicKey)]));
}

class HealthPairingSessionMaterial {
  const HealthPairingSessionMaterial({required this.secret, required this.secretHash, required this.challenge});
  final String secret, secretHash, challenge;
}

class HealthE2eePairing {
  HealthE2eePairing({required this.client, required this.healthE2ee, FlutterSecureStorage? secureStorage}) : _secureStorage = secureStorage ?? const FlutterSecureStorage();
  static const protocolVersion = 'pace-health-pairing-v1';
  static const algorithm = 'ECDH-P256/HKDF-SHA256/AES-256-KW';
  static const _prefix = 'pace.health.e2ee.pairing.v1.';
  final SupabaseClient client; final HealthE2eeService healthE2ee; final FlutterSecureStorage _secureStorage;
  final Ecdh _ecdh = Ecdh.p256(length: 32);

  Future<HealthPairingSessionMaterial> createSessionMaterial() async {
    final secret = _b64Url(_randomBytes(32));
    final challenge = _b64Url(_randomBytes(32));
    final hash = await Sha256().hash(utf8.encode(secret));
    return HealthPairingSessionMaterial(secret: secret, secretHash: _hex(hash.bytes), challenge: challenge);
  }
  Future<KeyPair> generateEphemeralKeyPair() => _ecdh.newKeyPair();
  Future<Map<String, dynamic>> exportPublicKey(KeyPair pair) async {
    final d = await pair.extract();
    if (d is! EcKeyPairData) throw StateError('Invalid P-256 pairing key.');
    return {'kty':'EC','crv':'P-256','x':_b64Url(d.x),'y':_b64Url(d.y)};
  }
  Future<String> createSession({required String initiatorDeviceId, required String secretHash, required String challenge, required Map<String,dynamic> ephemeralPublicKey, int expiresInSeconds=300}) async {
    final result = await client.rpc('create_pairing_session', params: {'p_initiator_device_id':initiatorDeviceId,'p_secret_hash':secretHash,'p_challenge':challenge,'p_ephemeral_pub':ephemeralPublicKey,'p_expires_in_seconds':expiresInSeconds});
    return result as String;
  }
  Future<void> joinSession({required String sessionId, required String secret, required String recipientDeviceId, required Map<String,dynamic> ephemeralPublicKey}) async {
    await client.rpc('join_pairing_session', params: {'p_session_id':sessionId,'p_secret_plaintext':secret,'p_recipient_device_id':recipientDeviceId,'p_ephemeral_pub':ephemeralPublicKey});
  }
  Future<Map<String,dynamic>?> getSession(String sessionId) async {
    final result = await client.rpc('get_pairing_session', params: {'p_session_id':sessionId});
    if (result is! List || result.isEmpty) return null;
    return Map<String,dynamic>.from(result.first as Map);
  }
  Future<void> confirmSession({required String sessionId, required String initiatorDeviceId}) => client.rpc('confirm_pairing_session', params: {'p_session_id':sessionId,'p_initiator_device_id':initiatorDeviceId}).then((_) {});
  Future<void> completeSession({required String sessionId, required String recipientDeviceId}) async { await client.rpc('complete_pairing_session', params: {'p_session_id':sessionId,'p_recipient_device_id':recipientDeviceId}); await _clear(sessionId); }

  Future<void> persistEphemeralKeyPair(String sessionId, KeyPair pair) async {
    final d=await pair.extract(); if(d is! EcKeyPairData) throw StateError('Invalid P-256 pairing key.');
    await _secureStorage.write(key:_key(sessionId,'ephemeral'),value:jsonEncode({'d':_b64Url(d.d),'x':_b64Url(d.x),'y':_b64Url(d.y)}),aOptions:const AndroidOptions(encryptedSharedPreferences:true));
  }
  Future<KeyPair?> readEphemeralKeyPair(String sessionId) async {
    final v=await _secureStorage.read(key:_key(sessionId,'ephemeral')); if(v==null) return null; final m=jsonDecode(v) as Map<String,dynamic>;
    return EcKeyPairData(d:_b64UrlDecode(m['d'] as String),x:_b64UrlDecode(m['x'] as String),y:_b64UrlDecode(m['y'] as String),type:KeyPairType.p256,debugLabel:'Pace health E2EE pairing ephemeral key');
  }
  Future<void> persistSecret(String sessionId,String secret) => _secureStorage.write(key:_key(sessionId,'secret'),value:secret,aOptions:const AndroidOptions(encryptedSharedPreferences:true));
  Future<String?> readSecret(String sessionId) => _secureStorage.read(key:_key(sessionId,'secret'));

  Future<List<int>> derivePairingBits({required List<int> sharedSecret, required HealthPairingContext context, required String purpose}) async {
    if(purpose!='wrap' && purpose!='sas') throw ArgumentError.value(purpose,'purpose');
    final salt=utf8.encode('$protocolVersion/$purpose/${context.sessionId}');
    final info=utf8.encode(jsonEncode([purpose,context.contextBytes()]));
    final key=await Hkdf(hmac:Hmac.sha256(),outputLength:32).deriveKey(secretKey:SecretKeyData(sharedSecret),nonce:salt,info:info);
    return key.extractBytes();
  }
  Future<SecretKey> derivePairingWrappingKey({required KeyPair privateKey,required Map<String,dynamic> peerPublicKey,required HealthPairingContext context}) async {
    final shared=await _shared(privateKey,peerPublicKey); final bits=await derivePairingBits(sharedSecret:shared,context:context,purpose:'wrap'); return SecretKeyData(bits);
  }
  Future<String> derivePairingSas({required KeyPair localPrivateKey,required Map<String,dynamic> peerPublicKey,required HealthPairingContext context}) async {
    final bits=await derivePairingBits(sharedSecret:await _shared(localPrivateKey,peerPublicKey),context:context,purpose:'sas');
    var value=BigInt.zero; for(final b in bits.take(8)){value=(value<<8)|BigInt.from(b);} value%=BigInt.from(1000000000); final s=value.toString().padLeft(9,'0'); return '${s.substring(0,3)}-${s.substring(3,6)}-${s.substring(6)}';
  }
  Future<String> derivePairingSasFromSharedSecret({required List<int> sharedSecret, required HealthPairingContext context}) async {
    final bits=await derivePairingBits(sharedSecret:sharedSecret,context:context,purpose:'sas');
    var value=BigInt.zero; for(final b in bits.take(8)){value=(value<<8)|BigInt.from(b);} value%=BigInt.from(1000000000); final s=value.toString().padLeft(9,'0'); return s.substring(0,3)+'-'+s.substring(3,6)+'-'+s.substring(6);
  }
  Future<Map<String,dynamic>> buildKeyBundle({required KeyPair localEphemeralKey,required Map<String,dynamic> peerEphemeralPublicKey,required HealthPairingContext context}) async {
    final kek=await (await derivePairingWrappingKey(privateKey:localEphemeralKey,peerPublicKey:peerEphemeralPublicKey,context:context)).extractBytes();
    final master=await healthE2ee.readMasterKeyForPairing(context.keyVersion); final dedupe=await healthE2ee.readDedupeRootKeyForPairing();
    return {'version':1,'health_master_key':{'wrapped_key':_b64Url(AesKeyWrap.wrap(kek,master)),'key_version':context.keyVersion},'dedupe_root_key':{'wrapped_key':_b64Url(AesKeyWrap.wrap(kek,dedupe))}};
  }
  Future<int> unwrapKeyBundle({required KeyPair localEphemeralKey,required Map<String,dynamic> peerEphemeralPublicKey,required HealthPairingContext context,required Map<String,dynamic> envelope}) async {
    if(envelope['version']!=1) throw StateError('Invalid health pairing envelope.'); final mk=envelope['health_master_key']; final dk=envelope['dedupe_root_key']; if(mk is! Map || dk is! Map) throw StateError('Invalid health pairing envelope.');
    final version=int.parse(mk['key_version'].toString()); if(version<1) throw StateError('Invalid health pairing key version.');
    final kek=await (await derivePairingWrappingKey(privateKey:localEphemeralKey,peerPublicKey:peerEphemeralPublicKey,context:context)).extractBytes();
    final master=AesKeyWrap.unwrap(kek,_b64UrlDecode(mk['wrapped_key'] as String)); final dedupe=AesKeyWrap.unwrap(kek,_b64UrlDecode(dk['wrapped_key'] as String));
    await healthE2ee.importPairingKeys(masterVersion:version,masterKey:master,dedupeRootKey:dedupe); return version;
  }
  Future<void> createEnvelope({required String sessionId,required String senderDeviceId,required String recipientDeviceId,required Map<String,dynamic> envelope,required int keyVersion}) async {
    await client.rpc('create_pairing_envelope',params:{'p_session_id':sessionId,'p_sender_device_id':senderDeviceId,'p_recipient_device_id':recipientDeviceId,'p_envelope':jsonEncode(envelope),'p_key_version':keyVersion,'p_algorithm':algorithm});
  }
  Future<List<int>> _shared(KeyPair privateKey,Map<String,dynamic> peer) async {
    if(peer['kty']!='EC'||peer['crv']!='P-256'||peer['x'] is! String||peer['y'] is! String) throw StateError('Invalid ECDH P-256 public key.');
    final remote=EcPublicKey(x:_b64UrlDecode(peer['x'] as String),y:_b64UrlDecode(peer['y'] as String),type:KeyPairType.p256); return (await _ecdh.sharedSecretKey(keyPair:privateKey,remotePublicKey:remote)).extractBytes();
  }
  static List<int> _randomBytes(int n){final r=Random.secure();return List<int>.generate(n,(_)=>r.nextInt(256));}
  static String _key(String id,String suffix)=>'$_prefix$id.$suffix';
  static String _b64Url(List<int> b)=>base64Url.encode(b).replaceAll('=','');
  static List<int> _b64UrlDecode(String v){final n=v.replaceAll('-','+').replaceAll('_','/');return base64Decode(n.padRight((n.length+3)~/4*4,'='));}
  static String _hex(List<int> b)=>b.map((x)=>x.toRadixString(16).padLeft(2,'0')).join();
  Future<void> _clear(String id) async {await _secureStorage.delete(key:_key(id,'ephemeral'));await _secureStorage.delete(key:_key(id,'secret'));}
}

Map<String,dynamic> _canonicalPublicKey(Map<String,dynamic> key){if(key['kty']!='EC'||key['crv']!='P-256'||key['x'] is! String||key['y'] is! String) throw StateError('Invalid ECDH P-256 public key.'); return {'crv':key['crv'],'kty':key['kty'],'x':key['x'],'y':key['y']};}
