import 'package:flutter/material.dart';

import '../../core/platform/health_adapter.dart';
import '../../core/platform/native_health_adapter.dart';
import '../../core/storage/local_store.dart';
import '../../core/sync/sync_service.dart';

class HealthPage extends StatefulWidget {
  const HealthPage({super.key, required this.localStore, required this.sync});
  final LocalStore localStore;
  final SyncService sync;

  @override
  State<HealthPage> createState() => _HealthPageState();
}

class _HealthPageState extends State<HealthPage> {
  late String? _accountUserId;
  final NativeHealthAdapter _adapter = NativeHealthAdapter();
  bool? _available;
  bool _busy = false;
  List<PaceHealthSample> _samples = const [];

  @override
  void initState() {
    super.initState();
    _accountUserId = widget.localStore.activeUserId;
    widget.localStore.addListener(_onLocalStoreChanged);
    _samples = _readStoredSamples();
  }

  List<PaceHealthSample> _readStoredSamples() {
    final raw = widget.localStore.read('pace.health.samples');
    if (raw is! List) return const <PaceHealthSample>[];
    return raw.whereType<Map>().map((entry) {
      final value = Map<String, dynamic>.from(entry);
      final timestamp = DateTime.tryParse(value['timestamp']?.toString() ?? '');
      final amount = value['value'];
      final type = value['type']?.toString();
      if (timestamp == null || amount is! num || type == null || type.isEmpty) {
        return null;
      }
      return PaceHealthSample(
        type: type,
        value: amount.toDouble(),
        timestamp: timestamp.toLocal(),
        unit: value['unit']?.toString(),
        source: value['source']?.toString(),
      );
    }).whereType<PaceHealthSample>().toList();
  }

  void _onLocalStoreChanged() {
    if (!mounted || widget.localStore.activeUserId != _accountUserId) return;
    final samples = _readStoredSamples();
    setState(() => _samples = samples);
  }

  @override
  void didUpdateWidget(covariant HealthPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.localStore != widget.localStore) {
      oldWidget.localStore.removeListener(_onLocalStoreChanged);
      widget.localStore.addListener(_onLocalStoreChanged);
      _samples = _readStoredSamples();
    }
  }

  @override
  void dispose() {
    widget.localStore.removeListener(_onLocalStoreChanged);
    super.dispose();
  }

  Future<void> _checkAndRead({bool request = false}) async {
    setState(() => _busy = true);
    try {
      final available = await _adapter.isAvailable();
      var permitted = available;
      if (available && request) permitted = await _adapter.requestPermissions();
      final samples = permitted ? await _adapter.readRecent() : const <PaceHealthSample>[];
      if (permitted && samples.isNotEmpty) {
        final payload = samples
            .map((sample) => {'type': sample.type, 'value': sample.value, 'timestamp': sample.timestamp.toUtc().toIso8601String(), 'unit': sample.unit, 'source': sample.source})
            .toList();
        await widget.localStore.writeForAccount(_accountUserId, 'pace.health.samples', payload);
        await widget.sync.syncNow();
      }
      if (!mounted) return;
      setState(() {
        _available = available && permitted;
        _samples = samples;
        _busy = false;
      });
    } catch (_) {
      if (mounted) setState(() { _busy = false; _available = false; });
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Santé')),
        body: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Card(
              child: ListTile(
                leading: Icon(_available == true ? Icons.check_circle : Icons.health_and_safety_outlined),
                title: Text(_available == true ? 'Source de santé disponible' : 'Health Connect / HealthKit non vérifié'),
                subtitle: const Text('Pace ne crée aucune donnée de santé artificielle.'),
                trailing: _busy ? const CircularProgressIndicator() : IconButton(onPressed: () => _checkAndRead(request: true), icon: const Icon(Icons.refresh)),
              ),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(onPressed: _busy ? null : () => _checkAndRead(request: true), icon: const Icon(Icons.security), label: const Text('Autoriser et synchroniser')),
            const SizedBox(height: 16),
            if (_samples.isEmpty)
              const Card(
                child: Padding(
                  padding: EdgeInsets.all(16),
                  child: Text('Aucune donnée accessible sur cette période, ou les permissions n’ont pas été accordées.'),
                ),
              ),
            if (_samples.isNotEmpty) ...[
              Text('${_samples.length} mesure(s) accessibles sur 7 jours', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              for (final sample in _samples.take(100)) Card(child: ListTile(title: Text(sample.type), subtitle: Text('${sample.value.toStringAsFixed(1)} ${sample.unit ?? ''} · ${sample.source ?? 'source inconnue'}'), trailing: Text(_format(sample.timestamp)))),
            ],
          ],
        ),
      );

  String _format(DateTime value) => '${value.day.toString().padLeft(2, '0')}/${value.month.toString().padLeft(2, '0')} ${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';
}
