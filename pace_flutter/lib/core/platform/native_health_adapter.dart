import 'package:health/health.dart';

import 'health_adapter.dart';

/// Real cross-platform health implementation backed by Health Connect on
/// Android and HealthKit on iOS/iPadOS. Unsupported desktop platforms return
/// an explicit unavailable state and never fabricate samples.
class NativeHealthAdapter implements HealthAdapter {
  NativeHealthAdapter() : _health = Health();

  final Health _health;
  static const _types = <HealthDataType>[
    HealthDataType.STEPS,
    HealthDataType.ACTIVE_ENERGY_BURNED,
    HealthDataType.HEART_RATE,
    HealthDataType.SLEEP_ASLEEP,
    HealthDataType.WEIGHT,
    HealthDataType.WORKOUT,
  ];

  Future<void> _configure() => _health.configure();

  @override
  Future<bool> isAvailable() async {
    try {
      await _configure();
      final status = await _health.getHealthConnectSdkStatus();
      if (status != null) return status == HealthConnectSdkStatus.sdkAvailable;
      return _health.platformType == HealthPlatformType.appleHealth;
    } catch (_) {
      return false;
    }
  }

  @override
  Future<bool> requestPermissions() async {
    try {
      await _configure();
      return await _health.requestAuthorization(
        _types,
        permissions: List<HealthDataAccess>.filled(_types.length, HealthDataAccess.READ),
      );
    } catch (_) {
      return false;
    }
  }

  @override
  Future<List<PaceHealthSample>> readRecent({Duration window = const Duration(days: 7)}) async {
    try {
      await _configure();
      final end = DateTime.now();
      final start = end.subtract(window);
      final points = await _health.getHealthDataFromTypes(
        types: _types,
        startTime: start,
        endTime: end,
      );
      final unique = _health.removeDuplicates(points);
      return unique.where((point) => point.value is NumericHealthValue).map((point) {
        final numeric = (point.value as NumericHealthValue).numericValue.toDouble();
        return PaceHealthSample(
          type: point.typeString.toLowerCase(),
          value: numeric,
          timestamp: point.dateTo.toLocal(),
          unit: point.unitString,
          source: point.sourceName,
        );
      }).toList();
    } catch (_) {
      return const <PaceHealthSample>[];
    }
  }
}
