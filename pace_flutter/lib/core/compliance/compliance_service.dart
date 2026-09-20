import 'package:supabase_flutter/supabase_flutter.dart';

class PaceComplianceService {
  const PaceComplianceService(this.client);

  final SupabaseClient? client;

  Future<void> recordConsent({
    required String consentType,
    required bool granted,
    required String legalVersion,
    required String policyVersion,
  }) async {
    final value = client;
    final user = value?.auth.currentUser;
    if (value == null || user == null) {
      throw StateError('Un compte connecté est requis.');
    }
    try {
      await value.from('consent_records').insert({
        'user_id': user.id,
        'consent_type': consentType,
        'granted': granted,
        'legal_version': legalVersion,
        'policy_version': policyVersion,
      });
    } on PostgrestException {
      throw StateError('Impossible d’enregistrer le consentement.');
    }
  }

  Future<void> requestAccountDeletion() async {
    final value = client;
    final user = value?.auth.currentUser;
    if (value == null || user == null) {
      throw StateError('Un compte connecté est requis.');
    }
    final rows = await value
        .from('data_deletion_requests')
        .insert({'user_id': user.id, 'status': 'pending'})
        .select('id')
        .limit(1);
    if (rows.isEmpty) throw StateError('Impossible de créer la demande de suppression.');
  }
}
