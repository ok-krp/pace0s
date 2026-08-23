import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';

import 'package:pace/core/photo/photo_picker_service.dart';

void main() {
  XFile file({String name = 'photo.jpg', int size = 4}) => XFile.fromData(Uint8List.fromList(List<int>.filled(size, 1)), name: name, mimeType: 'image/jpeg');

  test('accepts a supported image below the size limit', () async {
    await expectLater(PhotoPickerService.validate(file()), completes);
  });

  test('rejects an empty image', () async {
    await expectLater(
      PhotoPickerService.validate(file(size: 0)),
      throwsA(isA<PhotoPickerException>()),
    );
  });

  test('rejects an unsupported extension', () async {
    await expectLater(
      PhotoPickerService.validate(file(name: 'document.pdf')),
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

  test('detects common image media types', () {
    expect(PhotoPickerService.mediaTypeFor(file(name: 'photo.png')), 'image/png');
    expect(PhotoPickerService.mediaTypeFor(file(name: 'photo.webp')), 'image/webp');
    expect(PhotoPickerService.mediaTypeFor(file(name: 'photo.jpg')), 'image/jpeg');
  });
}
