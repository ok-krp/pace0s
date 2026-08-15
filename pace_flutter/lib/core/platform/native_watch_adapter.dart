import 'package:flutter/services.dart';

import 'watch_adapter.dart';

class NativeWatchAdapter implements WatchAdapter {
  const NativeWatchAdapter();

  static const MethodChannel _channel = MethodChannel('pace/watch');

  @override
  Future<bool> isAvailable() async {
    try {
      return await _channel.invokeMethod<bool>('isAvailable') ?? false;
    } on PlatformException {
      return false;
    }
  }

  @override
  Future<bool> requestPermissions() async {
    try {
      return await _channel.invokeMethod<bool>('requestPermissions') ?? false;
    } on PlatformException {
      return false;
    }
  }

  Future<List<Map<String, dynamic>>> scan() async {
    try {
      final result = await _channel.invokeMethod<List<dynamic>>('scan');
      return (result ?? const <dynamic>[]).whereType<Map>().map(Map<String, dynamic>.from).toList();
    } on PlatformException {
      return const <Map<String, dynamic>>[];
    }
  }

  Future<bool> connect(String identifier) async {
    try {
      return await _channel.invokeMethod<bool>('connect', {'identifier': identifier}) ?? false;
    } on PlatformException {
      return false;
    }
  }

  Future<Map<String, dynamic>?> status() async {
    try {
      final result = await _channel.invokeMethod<Map<dynamic, dynamic>>('status');
      return result == null ? null : Map<String, dynamic>.from(result);
    } on PlatformException {
      return null;
    }
  }
}
