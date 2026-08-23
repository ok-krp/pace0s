import 'dart:async';

import 'package:cross_file/cross_file.dart';
import 'package:flutter/foundation.dart';
import 'package:image_picker/image_picker.dart';

class PhotoPickerException implements Exception {
  const PhotoPickerException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// Platform-neutral boundary for camera/gallery selection.
///
/// Permissions are intentionally requested by the native picker only when a
/// source is used. No permission is requested during app startup.
class PhotoPickerService {
  PhotoPickerService({ImagePicker? picker}) : _picker = picker ?? ImagePicker();

  static const maxWidth = 2048.0;
  static const maxHeight = 2048.0;
  static const imageQuality = 82;
  static const maxBytes = 5 * 1024 * 1024;

  final ImagePicker _picker;

  Future<XFile?> pickFromCamera() => _pick(ImageSource.camera);

  Future<XFile?> pickFromGallery() => _pick(ImageSource.gallery);

  Future<XFile?> pick() async {
    throw const PhotoPickerException('Choisissez une source photo depuis l’interface Pace.');
  }

  Future<XFile?> _pick(ImageSource source) async {
    try {
      final file = await _picker.pickImage(
        source: source,
        maxWidth: maxWidth,
        maxHeight: maxHeight,
        imageQuality: imageQuality,
        requestFullMetadata: false,
        preferredCameraDevice: CameraDevice.rear,
      );
      if (file == null) return null;
      await validate(file);
      return file;
    } on PhotoPickerException {
      rethrow;
    } on UnsupportedError {
      throw const PhotoPickerException('Cette plateforme ne prend pas en charge cette source photo.');
    } on Exception catch (error) {
      final message = error.toString().toLowerCase();
      if (message.contains('permission') || message.contains('denied') || message.contains('authorized')) {
        throw const PhotoPickerException('Accès photo refusé. Autorisez l’accès dans les réglages de l’appareil puis réessayez.');
      }
      throw const PhotoPickerException('Impossible de sélectionner cette image. Réessayez avec une autre photo.');
    }
  }

  static Future<void> validate(XFile file) async {
    final size = await file.length();
    if (size <= 0) throw const PhotoPickerException('Le fichier sélectionné est vide ou illisible.');
    if (size > maxBytes) {
      throw const PhotoPickerException('Cette image est trop volumineuse. Choisissez une image de moins de 5 Mo.');
    }
    final name = file.name.toLowerCase();
    const supported = <String>{'.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.gif', '.bmp'};
    if (!supported.any(name.endsWith)) {
      throw const PhotoPickerException('Format d’image non pris en charge.');
    }
  }

  static String mediaTypeFor(XFile file) {
    final name = file.name.toLowerCase();
    if (name.endsWith('.png')) return 'image/png';
    if (name.endsWith('.webp')) return 'image/webp';
    if (name.endsWith('.heic')) return 'image/heic';
    if (name.endsWith('.heif')) return 'image/heif';
    if (name.endsWith('.gif')) return 'image/gif';
    if (name.endsWith('.bmp')) return 'image/bmp';
    return 'image/jpeg';
  }

  static Future<String> dataUrl(XFile file) async {
    await validate(file);
    final bytes = await file.readAsBytes();
    if (bytes.isEmpty) throw const PhotoPickerException('Impossible de lire l’image sélectionnée.');
    return 'data:${mediaTypeFor(file)};base64,${base64Encode(bytes)}';
  }
}

String base64Encode(List<int> bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  final output = StringBuffer();
  for (var i = 0; i < bytes.length; i += 3) {
    final a = bytes[i];
    final hasB = i + 1 < bytes.length;
    final hasC = i + 2 < bytes.length;
    final b = hasB ? bytes[i + 1] : 0;
    final c = hasC ? bytes[i + 2] : 0;
    output
      ..write(alphabet[(a >> 2) & 0x3f])
      ..write(alphabet[((a & 3) << 4) | (b >> 4)])
      ..write(hasB ? alphabet[((b & 15) << 2) | (c >> 6)] : '=')
      ..write(hasC ? alphabet[c & 63] : '=');
  }
  return output.toString();
}
