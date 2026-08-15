enum SyncOperation { create, update, delete }

class SyncMutation {
  const SyncMutation({
    required this.id,
    required this.domain,
    required this.operation,
    required this.payload,
    required this.createdAt,
  });

  final String id;
  final String domain;
  final SyncOperation operation;
  final Map<String, dynamic> payload;
  final DateTime createdAt;
}

abstract interface class SyncEngine {
  Future<void> enqueue(SyncMutation mutation);
  Future<void> flush();
}
