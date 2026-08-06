ALTER TABLE public.ai_conversations
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS summarized_count integer NOT NULL DEFAULT 0;