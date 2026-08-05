CREATE TABLE public.ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  agent_type text NOT NULL CHECK (agent_type IN ('coach', 'build')),
  title text NOT NULL DEFAULT 'Nouvelle conversation',
  memory_summary text,
  is_starred boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  is_ephemeral boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_conversations TO authenticated;
GRANT ALL ON public.ai_conversations TO service_role;
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own AI conversations" ON public.ai_conversations FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  parts jsonb NOT NULL DEFAULT '[]'::jsonb,
  plain_text text NOT NULL DEFAULT '',
  model_message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_messages TO authenticated;
GRANT ALL ON public.ai_messages TO service_role;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own AI messages" ON public.ai_messages FOR ALL TO authenticated USING (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.ai_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid())) WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.ai_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()));

CREATE TABLE public.ai_preferences (
  user_id uuid PRIMARY KEY,
  memory_level text NOT NULL DEFAULT 'limited' CHECK (memory_level IN ('none', 'limited', 'complete')),
  permissions jsonb NOT NULL DEFAULT '{"profile":true,"nutrition":true,"sport":true,"sleep":false,"water":false,"habits":false,"calendar":false,"work":false,"finance":false}'::jsonb,
  confirm_actions boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_preferences TO authenticated;
GRANT ALL ON public.ai_preferences TO service_role;
ALTER TABLE public.ai_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own AI preferences" ON public.ai_preferences FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.ai_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  conversation_id uuid REFERENCES public.ai_conversations(id) ON DELETE SET NULL,
  agent_type text NOT NULL CHECK (agent_type IN ('coach', 'build')),
  action_type text NOT NULL,
  label text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'executed', 'rejected', 'failed')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_action_log TO authenticated;
GRANT ALL ON public.ai_action_log TO service_role;
ALTER TABLE public.ai_action_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own AI action log" ON public.ai_action_log FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.development_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  conversation_id uuid REFERENCES public.ai_conversations(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('bug', 'improvement', 'feature', 'task')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'planned', 'in_progress', 'done', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.development_tasks TO authenticated;
GRANT ALL ON public.development_tasks TO service_role;
ALTER TABLE public.development_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own development tasks" ON public.development_tasks FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX ai_conversations_user_agent_updated_idx ON public.ai_conversations(user_id, agent_type, updated_at DESC);
CREATE INDEX ai_messages_conversation_created_idx ON public.ai_messages(conversation_id, created_at);
CREATE INDEX ai_action_log_user_created_idx ON public.ai_action_log(user_id, created_at DESC);
CREATE INDEX development_tasks_user_status_idx ON public.development_tasks(user_id, status, updated_at DESC);

CREATE TRIGGER ai_conversations_touch BEFORE UPDATE ON public.ai_conversations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER ai_preferences_touch BEFORE UPDATE ON public.ai_preferences FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER development_tasks_touch BEFORE UPDATE ON public.development_tasks FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();