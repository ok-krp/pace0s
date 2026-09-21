import 'package:flutter/material.dart';

import '../../core/compliance/compliance_service.dart';
import '../../core/platform/health_adapter.dart';
import '../../core/platform/native_health_adapter.dart';
import '../../core/security/health_e2ee_service.dart';
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
  final NativeHealthAdapter _adapter = NativeHealthAdapter();
  bool? _available;
  bool _busy = false;
  List<PaceHealthSample> _samples = const [];

  Future<void> _checkAndRead({bool request = false}) async {
    setState(() => _busy = true);
    try {
      final compliance = PaceComplianceService(widget.sync.client);
      final healthConsent = await compliance.hasConsent('health_data');
      if (!healthConsent && request) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Activez d’abord le consentement « Accès aux données de santé » dans Paramètres.')));
          setState(() => _busy = false);
        }
        return;
      }
      if (!healthConsent) {
        if (mounted) setState(() { _busy = false; _available = false; _samples = const []; });
        return;
      }
      final available = await _adapter.isAvailable();
      var permitted = available;
      if (available && request) permitted = await _adapter.requestPermissions();
      final samples = permitted ? await _adapter.readRecent() : const <PaceHealthSample>[];
      final cloudConsent = await compliance.hasConsent('health_cloud_sync');
      if (permitted && samples.isNotEmpty && cloudConsent) {
        final e2ee = HealthE2eeService(client: widget.sync.client!);
        await e2ee.uploadSamples(samples);
      } else if (permitted && samples.isNotEmpty && !cloudConsent) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Données lues localement. Activez la synchronisation santé cloud pour les envoyer à Pace.')));
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
