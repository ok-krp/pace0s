import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';

import 'package:pace/core/photo/photo_picker_service.dart';

void main() {
  XFile file({String? name, String? mimeType, int size = 4}) => XFile.fromData(
        Uint8List.fromList(List<int>.filled(size, 1)),
        name: name,
        mimeType: mimeType,
      );

  test('accepts a supported image below the size limit', () async {
    await expectLater(
      PhotoPickerService.validate(
        file(name: 'photo.jpg', mimeType: 'image/jpeg'),
      ),
      completes,
    );
  });

  test('rejects an empty image', () async {
    await expectLater(
      PhotoPickerService.validate(
        file(name: 'photo.jpg', mimeType: 'image/jpeg', size: 0),
      ),
      throwsA(isA<PhotoPickerException>()),
    );
  });

  test('rejects an unsupported image MIME type', () async {
    await expectLater(
      PhotoPickerService.validate(
        file(mimeType: 'application/pdf'),
      ),
      throwsA(isA<PhotoPickerException>()),
    );
  });

  test('rejects images over the maximum size', () async {
    final oversized = XFile.fromData(
      Uint8List.fromList(List<int>.filled(PhotoPickerService.maxBytes + 1, 1)),
      name: 'large.jpg',
      mimeType: 'image/jpeg',
    );
    await expectLater(
      PhotoPickerService.validate(oversized),
      throwsA(isA<PhotoPickerException>()),
    );
  });

  test('detects common image media types from MIME metadata', () {
    expect(
      PhotoPickerService.mediaTypeFor(
        file(mimeType: 'image/png'),
      ),
      'image/png',
    );
    expect(
      PhotoPickerService.mediaTypeFor(
        file(mimeType: 'image/webp'),
      ),
      'image/webp',
    );
    expect(
      PhotoPickerService.mediaTypeFor(
        file(mimeType: 'image/jpeg'),
      ),
      'image/jpeg',
    );
  });
}
