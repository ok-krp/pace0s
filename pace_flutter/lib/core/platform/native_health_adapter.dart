import 'package:flutter/services.dart';

import 'health_adapter.dart';

/// Common Flutter-facing health adapter. Platform code is responsible for the
/// actual Health Connect / HealthKit calls; unsupported platforms report an
/// explicit unavailable state rather than returning synthetic samples.
class NativeHealthAdapter implements HealthAdapter {
  const NativeHealthAdapter();

  static const MethodChannel _channel = MethodChannel('pace/health');

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

  @override
  Future<List<PaceHealthSample>> readRecent({Duration window = const Duration(days: 7)}) async {
    try {
      final raw = await _channel.invokeMethod<List<dynamic>>('readRecent', {'days': window.inDays});
      return (raw ?? const <dynamic>[]).whereType<Map>().map((item) {
        final value = Map<String, dynamic>.from(item);
        return PaceHealthSample(
          type: value['type']?.toString() ?? 'unknown',
          value: value['value'] is num ? (value['value'] as num).toDouble() : 0,
          timestamp: DateTime.tryParse(value['timestamp']?.toString() ?? '') ?? DateTime.now(),
          unit: value['unit']?.toString(),
          source: value['source']?.toString(),
        );
      }).toList();
    } on PlatformException {
      return const <PaceHealthSample>[];
    }
  }
}
