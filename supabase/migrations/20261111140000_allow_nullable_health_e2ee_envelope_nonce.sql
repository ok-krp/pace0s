-- AES Key Wrap pairing envelopes do not carry an AEAD nonce.
-- AES-GCM envelopes continue to store their generated nonce in this column.
begin;

alter table public.health_e2ee_key_envelopes
  alter column nonce drop not null;

comment on column public.health_e2ee_key_envelopes.nonce is
  'NULL for AES Key Wrap envelope algorithms; populated for AES-GCM envelope algorithms.';

commit;
