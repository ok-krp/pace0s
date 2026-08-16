class PaceWatchSample {
  const PaceWatchSample({required this.type, required this.value, required this.timestamp, this.unit});

  final String type;
  final double value;
  final DateTime timestamp;
  final String? unit;
}

abstract interface class WatchAdapter {
  Future<bool> isAvailable();
  Future<void> startScan();
  Future<void> stopScan();
  Future<void> connect(String deviceId);
  Future<void> disconnect();
  Stream<PaceWatchSample> get samples;
}
