import 'package:supabase_flutter/supabase_flutter.dart';

/// Keeps functional cross-device sync consent in legal_consent.opts, matching
/// the Web consent model. consent_records is reserved for granular categories
/// declared by its database CHECK constraint (health_data, health_cloud_sync,
/// financial_data, ai_processing and marketing).
class PaceComplianceService {
  const PaceComplianceService(this.client);

  final SupabaseClient? client;

  static bool legalConsentOptionGranted(dynamic rawOptions, String option) {
    if (rawOptions is! Map) return false;
    return rawOptions[option] == true;
  }

  static Map<String, dynamic> withLegalConsentOption(
    dynamic rawOptions, {
    required String option,
    required bool granted,
  }) {
    final options = rawOptions is Map
        ? Map<String, dynamic>.from(rawOptions)
        : <String, dynamic>{};
    options[option] = granted;
    return options;
  }

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

    if (consentType == 'sync_cloud') {
      await _recordLegalConsentOption(value, user.id, granted);
      return;
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

  Future<void> _recordLegalConsentOption(
    SupabaseClient value,
    String userId,
    bool granted,
  ) async {
    try {
      final rows = await value
          .from('legal_consent')
          .select('region,eula_version,privacy_version,consented_at,ip_country,opts')
          .eq('user_id', userId)
          .order('updated_at', ascending: false)
          .limit(1);

      if (value.auth.currentUser?.id != userId) {
        throw StateError('La session a changé pendant la mise à jour du consentement.');
      }
      if (rows.isEmpty) {
        throw StateError(
          'Le consentement initial de confidentialité doit être enregistré avant d’activer la synchronisation entre appareils.',
        );
      }

      final current = Map<String, dynamic>.from(rows.first);
      final nextOptions = withLegalConsentOption(
        current['opts'],
        option: 'sync_cloud',
        granted: granted,
      );

      await value.from('legal_consent').upsert(
        {
          'user_id': userId,
          'region': current['region'],
          'eula_version': current['eula_version'],
          'privacy_version': current['privacy_version'],
          'consented_at': current['consented_at'],
          'ip_country': current['ip_country'],
          'opts': nextOptions,
          'updated_at': DateTime.now().toUtc().toIso8601String(),
        },
        onConflict: 'user_id,eula_version,privacy_version',
      );
    } on PostgrestException {
      throw StateError('Impossible d’enregistrer le consentement de synchronisation.');
    }
  }

  Future<bool> hasConsent(String consentType) async {
    final value = client;
    final user = value?.auth.currentUser;
    if (value == null || user == null) return false;

    if (consentType == 'sync_cloud') {
      final rows = await value
          .from('legal_consent')
          .select('opts')
          .eq('user_id', user.id)
          .order('updated_at', ascending: false)
          .limit(1);
      if (value.auth.currentUser?.id != user.id || rows.isEmpty) return false;
      return legalConsentOptionGranted(rows.first['opts'], 'sync_cloud');
    }

    final rows = await value
        .from('consent_records')
        .select('granted')
        .eq('user_id', user.id)
        .eq('consent_type', consentType)
        .order('created_at', ascending: false)
        .limit(1);
    if (value.auth.currentUser?.id != user.id) return false;
    return rows.isNotEmpty && rows.first['granted'] == true;
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
