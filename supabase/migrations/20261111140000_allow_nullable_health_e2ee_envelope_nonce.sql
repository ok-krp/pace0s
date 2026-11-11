-- AES Key Wrap pairing envelopes do not carry an AEAD nonce.
-- AES-GCM envelopes continue to store their generated nonce in this column.
begin;

alter table public.health_e2ee_key_envelopes
  alter column nonce drop not null;

-- AES-GCM is nonce-bearing; AES Key Wrap formats are nonce-free. Add the
-- constraint NOT VALID so historic rows can be inventoried/repaired first.
-- PostgreSQL still enforces this check for every new or modified row.
alter table public.health_e2ee_key_envelopes
  add constraint health_e2ee_key_envelopes_nonce_algorithm_check
  check (
    (algorithm = 'ECDH-P256/AES-256-GCM' and nonce is not null)
    or (
      algorithm in (
        'ECDH-P256/AES-256-KW',
        'ECDH-P256/AES-256-KW/KEY-BUNDLE-V1',
        'ECDH-P256/HKDF-SHA256/AES-256-KW'
      )
      and nonce is null
    )
  ) not valid;

comment on column public.health_e2ee_key_envelopes.nonce is
  'NULL for AES Key Wrap envelope algorithms; populated for AES-GCM envelope algorithms.';

commit;
