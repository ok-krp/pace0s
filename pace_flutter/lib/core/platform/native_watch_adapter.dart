import 'package:flutter/services.dart';

import 'watch_adapter.dart';

class NativeWatchAdapter implements WatchAdapter {
  const NativeWatchAdapter();

  static const MethodChannel _channel = MethodChannel('pace/watch');
  static const EventChannel _events = EventChannel('pace/watch/events');

  @override
  Future<bool> isAvailable() async {
    try {
      return await _channel.invokeMethod<bool>('isAvailable') ?? false;
    } on PlatformException {
      return false;
    }
  }

  Future<bool> requestPermissions() async {
    try {
      return await _channel.invokeMethod<bool>('requestPermissions') ?? false;
    } on PlatformException {
      return false;
    }
  }

  @override
  Future<void> startScan() async {
    try {
      await _channel.invokeMethod<void>('startScan');
    } on PlatformException {
      // Unsupported platforms/providers expose an unavailable scan operation.
    }
  }

  @override
  Future<void> stopScan() async {
    try {
      await _channel.invokeMethod<void>('stopScan');
    } on PlatformException {
      // Unsupported platforms/providers expose an unavailable scan operation.
    }
  }

  @override
  Future<void> connect(String deviceId) async {
    try {
      await _channel.invokeMethod<void>('connect', {'identifier': deviceId});
    } on PlatformException {
      // The platform adapter reports connection state when supported.
    }
  }

  @override
  Future<void> disconnect() async {
    try {
      await _channel.invokeMethod<void>('disconnect');
    } on PlatformException {
      // No native watch provider is available.
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

  Future<Map<String, dynamic>?> status() async {
    try {
      final result = await _channel.invokeMethod<Map<dynamic, dynamic>>('status');
      return result == null ? null : Map<String, dynamic>.from(result);
    } on PlatformException {
      return null;
    }
  }

  @override
  Stream<PaceWatchSample> get samples => _events.receiveBroadcastStream().where((value) => value is Map).map((value) {
        final item = Map<String, dynamic>.from(value as Map);
        return PaceWatchSample(
          type: item['type']?.toString() ?? 'unknown',
          value: item['value'] is num ? (item['value'] as num).toDouble() : 0,
          timestamp: DateTime.tryParse(item['timestamp']?.toString() ?? '') ?? DateTime.now(),
          unit: item['unit']?.toString(),
        );
      });
}
