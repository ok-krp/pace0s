import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// Small transactional JSON store used only as the first migration primitive.
/// It deliberately has no dependency on the web application or a remote URL.
class LocalStore {
  LocalStore._(this._file);

  final File _file;
  Map<String, dynamic> _data = <String, dynamic>{};

  static Future<LocalStore> open() async {
    final directory = await getApplicationSupportDirectory();
    final file = File(p.join(directory.path, 'pace_local.json'));
    final store = LocalStore._(file);
    if (await file.exists()) {
      try {
        final decoded = jsonDecode(await file.readAsString());
        if (decoded is Map<String, dynamic>) store._data = decoded;
      } catch (_) {
        // Corrupt local state must never prevent the native UI from starting.
        store._data = <String, dynamic>{};
      }
    }
    return store;
  }

  dynamic read(String key) => _data[key];

  Future<void> write(String key, dynamic value) async {
    _data[key] = value;
    await _flush();
  }

  Future<void> remove(String key) async {
    _data.remove(key);
    await _flush();
  }

  Future<void> _flush() async {
    await _file.parent.create(recursive: true);
    final temporary = File('${_file.path}.tmp');
    await temporary.writeAsString(jsonEncode(_data), flush: true);
    await temporary.rename(_file.path);
  }
}
