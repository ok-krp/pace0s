create index if not exists health_e2ee_envelopes_device_fk_idx on public.health_e2ee_key_envelopes (device_id);
create index if not exists health_e2ee_envelopes_sender_device_fk_idx on public.health_e2ee_key_envelopes (sender_device_id);
create index if not exists health_e2ee_pairing_sessions_recipient_device_fk_idx on public.health_e2ee_pairing_sessions (recipient_device_id);
create index if not exists health_legacy_migration_map_user_fk_idx on public.health_legacy_migration_map (user_id);
