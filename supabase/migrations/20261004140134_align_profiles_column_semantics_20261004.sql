-- Match the canonical source semantics for profiles.
alter table public.profiles
  alter column id drop default;

alter table public.profiles
  alter column training_sessions_goal drop not null;
