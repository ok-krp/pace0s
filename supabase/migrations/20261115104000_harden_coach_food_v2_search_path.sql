-- Harden the remaining authenticated SECURITY DEFINER RPC with an empty search_path.
alter function public.insert_coach_ai_food_idempotent_v2(
  uuid,uuid,text,text,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,jsonb
) set search_path = '';
