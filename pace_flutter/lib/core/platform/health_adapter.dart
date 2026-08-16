class PaceHealthSample {
  const PaceHealthSample({
    required this.type,
    required this.value,
    required this.timestamp,
    this.unit,
    this.source,
  });

  final String type;
  final double value;
  final DateTime timestamp;
  final String? unit;
  final String? source;
}

abstract interface class HealthAdapter {
  Future<bool> isAvailable();
  Future<bool> requestPermissions();
  Future<List<PaceHealthSample>> readRecent({Duration window = const Duration(days: 7)});
}
