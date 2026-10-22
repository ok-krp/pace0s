enum PaceAiAgent { coach, build }

/// Parse local ISO timestamps without accepting DateTime.parse's overflowing
/// calendar normalization (for example, day 45 rolling into the next month).
DateTime? _parseTimestamp(String? value) {
  if (value == null) return null;
  final match = RegExp(
    r'^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))?
class AiMessage {
  const AiMessage({required this.id, required this.role, required this.text, required this.createdAt});

  final String id;
  final String role;
  final String text;
  final DateTime createdAt;

  Map<String, dynamic> toJson() => {
        'id': id,
        'role': role,
        'text': text,
        'createdAt': createdAt.toUtc().toIso8601String(),
      };

  factory AiMessage.fromJson(Map<String, dynamic> json) => AiMessage(
        id: json['id']?.toString() ?? '',
        role: json['role']?.toString() ?? 'assistant',
        text: json['text']?.toString() ?? '',
        // Invalid local metadata must not look newer than valid cloud data.
        createdAt: _parseTimestamp(json['createdAt']?.toString())?.toLocal() ??
            DateTime.fromMillisecondsSinceEpoch(0),
      );
}

class AiConversation {
  const AiConversation({
    required this.id,
    required this.agent,
    required this.title,
    required this.updatedAt,
    this.messages = const <AiMessage>[],
    this.ephemeral = false,
  });

  final String id;
  final PaceAiAgent agent;
  final String title;
  final DateTime updatedAt;
  final List<AiMessage> messages;
  final bool ephemeral;

  AiConversation copyWith({String? title, DateTime? updatedAt, List<AiMessage>? messages}) => AiConversation(
        id: id,
        agent: agent,
        title: title ?? this.title,
        updatedAt: updatedAt ?? this.updatedAt,
        messages: messages ?? this.messages,
        ephemeral: ephemeral,
      );

  /// Merge remote metadata only when it is newer. A stale cloud row must not
  /// erase an offline rename or move a locally newer conversation backward.
  AiConversation mergeRemoteMetadata(AiConversation remote) {
    if (remote.id != id || !remote.updatedAt.isAfter(updatedAt)) return this;
    return copyWith(title: remote.title, updatedAt: remote.updatedAt);
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'agent': agent.name,
        'title': title,
        'updatedAt': updatedAt.toUtc().toIso8601String(),
        'messages': messages.map((message) => message.toJson()).toList(),
        'ephemeral': ephemeral,
      };

  factory AiConversation.fromJson(Map<String, dynamic> json) => AiConversation(
        id: json['id']?.toString() ?? '',
        agent: PaceAiAgent.values.firstWhere(
          (value) => value.name == json['agent'],
          orElse: () => PaceAiAgent.coach,
        ),
        title: json['title']?.toString() ?? 'Nouvelle conversation',
        // DateTime.now() here would make a corrupt/missing timestamp win
        // newest-wins reconciliation and could push a stale title to cloud.
        updatedAt: _parseTimestamp(json['updatedAt']?.toString())?.toLocal() ??
            DateTime.fromMillisecondsSinceEpoch(0),
        messages: json['messages'] is List
            ? (json['messages'] as List)
                .whereType<Map>()
                .map((value) => AiMessage.fromJson(Map<String, dynamic>.from(value)))
                .toList()
            : const <AiMessage>[],
        ephemeral: json['ephemeral'] == true,
      );
}

class AiMemoryItem {
  const AiMemoryItem({required this.id, required this.text, required this.createdAt, this.updatedAt});

  final String id;
  final String text;
  final DateTime createdAt;
  final DateTime? updatedAt;

  Map<String, dynamic> toJson() => {
        'id': id,
        'text': text,
        'createdAt': createdAt.toUtc().toIso8601String(),
        'updatedAt': updatedAt?.toUtc().toIso8601String(),
      };

  factory AiMemoryItem.fromJson(Map<String, dynamic> json) => AiMemoryItem(
        id: json['id']?.toString() ?? '',
        text: json['text']?.toString() ?? '',
        createdAt: DateTime.tryParse(json['createdAt']?.toString() ?? '')?.toLocal() ??
            DateTime.fromMillisecondsSinceEpoch(0),
        updatedAt: DateTime.tryParse(json['updatedAt']?.toString() ?? '')?.toLocal(),
      );
}
,
  ).firstMatch(value);
  if (match == null) return null;
  final parsed = DateTime.tryParse(value);
  if (parsed == null) return null;
  final fraction = match.group(7);
  if (fraction != null && fraction.length > 6) return null;

  final year = int.parse(match.group(1)!);
  final month = int.parse(match.group(2)!);
  final day = int.parse(match.group(3)!);
  final hour = int.parse(match.group(4)!);
  final minute = int.parse(match.group(5)!);
  final second = int.parse(match.group(6)!);
  if (year < 1) return null;
  final normalized = DateTime.utc(year, month, day, hour, minute, second);
  if (normalized.year != year ||
      normalized.month != month ||
      normalized.day != day ||
      normalized.hour != hour ||
      normalized.minute != minute ||
      normalized.second != second) {
    return null;
  }

  if (match.group(8) != null && match.group(8) != 'Z') {
    final offsetHours = int.parse(match.group(10)!);
    final offsetMinutes = int.parse(match.group(11)!);
    if (offsetHours > 14 ||
        offsetMinutes > 59 ||
        (offsetHours == 14 && offsetMinutes != 0)) {
      return null;
    }
  }
  return parsed;
}

class AiMessage {
  const AiMessage({required this.id, required this.role, required this.text, required this.createdAt});

  final String id;
  final String role;
  final String text;
  final DateTime createdAt;

  Map<String, dynamic> toJson() => {
        'id': id,
        'role': role,
        'text': text,
        'createdAt': createdAt.toUtc().toIso8601String(),
      };

  factory AiMessage.fromJson(Map<String, dynamic> json) => AiMessage(
        id: json['id']?.toString() ?? '',
        role: json['role']?.toString() ?? 'assistant',
        text: json['text']?.toString() ?? '',
        // Invalid local metadata must not look newer than valid cloud data.
        createdAt: DateTime.tryParse(json['createdAt']?.toString() ?? '')?.toLocal() ??
            DateTime.fromMillisecondsSinceEpoch(0),
      );
}

class AiConversation {
  const AiConversation({
    required this.id,
    required this.agent,
    required this.title,
    required this.updatedAt,
    this.messages = const <AiMessage>[],
    this.ephemeral = false,
  });

  final String id;
  final PaceAiAgent agent;
  final String title;
  final DateTime updatedAt;
  final List<AiMessage> messages;
  final bool ephemeral;

  AiConversation copyWith({String? title, DateTime? updatedAt, List<AiMessage>? messages}) => AiConversation(
        id: id,
        agent: agent,
        title: title ?? this.title,
        updatedAt: updatedAt ?? this.updatedAt,
        messages: messages ?? this.messages,
        ephemeral: ephemeral,
      );

  /// Merge remote metadata only when it is newer. A stale cloud row must not
  /// erase an offline rename or move a locally newer conversation backward.
  AiConversation mergeRemoteMetadata(AiConversation remote) {
    if (remote.id != id || !remote.updatedAt.isAfter(updatedAt)) return this;
    return copyWith(title: remote.title, updatedAt: remote.updatedAt);
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'agent': agent.name,
        'title': title,
        'updatedAt': updatedAt.toUtc().toIso8601String(),
        'messages': messages.map((message) => message.toJson()).toList(),
        'ephemeral': ephemeral,
      };

  factory AiConversation.fromJson(Map<String, dynamic> json) => AiConversation(
        id: json['id']?.toString() ?? '',
        agent: PaceAiAgent.values.firstWhere(
          (value) => value.name == json['agent'],
          orElse: () => PaceAiAgent.coach,
        ),
        title: json['title']?.toString() ?? 'Nouvelle conversation',
        // DateTime.now() here would make a corrupt/missing timestamp win
        // newest-wins reconciliation and could push a stale title to cloud.
        updatedAt: DateTime.tryParse(json['updatedAt']?.toString() ?? '')?.toLocal() ??
            DateTime.fromMillisecondsSinceEpoch(0),
        messages: json['messages'] is List
            ? (json['messages'] as List)
                .whereType<Map>()
                .map((value) => AiMessage.fromJson(Map<String, dynamic>.from(value)))
                .toList()
            : const <AiMessage>[],
        ephemeral: json['ephemeral'] == true,
      );
}

class AiMemoryItem {
  const AiMemoryItem({required this.id, required this.text, required this.createdAt, this.updatedAt});

  final String id;
  final String text;
  final DateTime createdAt;
  final DateTime? updatedAt;

  Map<String, dynamic> toJson() => {
        'id': id,
        'text': text,
        'createdAt': createdAt.toUtc().toIso8601String(),
        'updatedAt': updatedAt?.toUtc().toIso8601String(),
      };

  factory AiMemoryItem.fromJson(Map<String, dynamic> json) => AiMemoryItem(
        id: json['id']?.toString() ?? '',
        text: json['text']?.toString() ?? '',
        createdAt: DateTime.tryParse(json['createdAt']?.toString() ?? '')?.toLocal() ??
            DateTime.fromMillisecondsSinceEpoch(0),
        updatedAt: DateTime.tryParse(json['updatedAt']?.toString() ?? '')?.toLocal(),
      );
}
