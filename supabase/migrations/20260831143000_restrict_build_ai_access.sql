-- BUILD IA is an administrator-only surface.
-- Keep Coach IA user-scoped while preventing direct client access to build conversations/messages.

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_conversations'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.ai_conversations', policy_row.policyname);
  END LOOP;

  FOR policy_row IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ai_messages'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.ai_messages', policy_row.policyname);
  END LOOP;
END $$;

CREATE POLICY "AI conversations are private and build is admin only"
ON public.ai_conversations
FOR SELECT TO authenticated
USING (
  auth.uid() = user_id
  AND (
    agent_type = 'coach'
    OR lower(coalesce(auth.jwt() ->> 'email', '')) = 'mathieu.lequint@gmail.com'
  )
);

CREATE POLICY "Users can create coach conversations; build is admin only"
ON public.ai_conversations
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND (
    agent_type = 'coach'
    OR lower(coalesce(auth.jwt() ->> 'email', '')) = 'mathieu.lequint@gmail.com'
  )
);

CREATE POLICY "AI conversations can be changed only by owner; build is admin only"
ON public.ai_conversations
FOR UPDATE TO authenticated
USING (
  auth.uid() = user_id
  AND (
    agent_type = 'coach'
    OR lower(coalesce(auth.jwt() ->> 'email', '')) = 'mathieu.lequint@gmail.com'
  )
)
WITH CHECK (
  auth.uid() = user_id
  AND (
    agent_type = 'coach'
    OR lower(coalesce(auth.jwt() ->> 'email', '')) = 'mathieu.lequint@gmail.com'
  )
);

CREATE POLICY "AI conversations can be deleted only by owner; build is admin only"
ON public.ai_conversations
FOR DELETE TO authenticated
USING (
  auth.uid() = user_id
  AND (
    agent_type = 'coach'
    OR lower(coalesce(auth.jwt() ->> 'email', '')) = 'mathieu.lequint@gmail.com'
  )
);

CREATE POLICY "AI messages are private and build is admin only"
ON public.ai_messages
FOR SELECT TO authenticated
USING (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1
    FROM public.ai_conversations c
    WHERE c.id = conversation_id
      AND c.user_id = auth.uid()
      AND (
        c.agent_type = 'coach'
        OR lower(coalesce(auth.jwt() ->> 'email', '')) = 'mathieu.lequint@gmail.com'
      )
  )
);

CREATE POLICY "AI messages can be created only in allowed conversations"
ON public.ai_messages
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1
    FROM public.ai_conversations c
    WHERE c.id = conversation_id
      AND c.user_id = auth.uid()
      AND (
        c.agent_type = 'coach'
        OR lower(coalesce(auth.jwt() ->> 'email', '')) = 'mathieu.lequint@gmail.com'
      )
  )
);

CREATE POLICY "AI messages can be changed only in allowed conversations"
ON public.ai_messages
FOR UPDATE TO authenticated
USING (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1
    FROM public.ai_conversations c
    WHERE c.id = conversation_id
      AND c.user_id = auth.uid()
      AND (
        c.agent_type = 'coach'
        OR lower(coalesce(auth.jwt() ->> 'email', '')) = 'mathieu.lequint@gmail.com'
      )
  )
)
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1
    FROM public.ai_conversations c
    WHERE c.id = conversation_id
      AND c.user_id = auth.uid()
      AND (
        c.agent_type = 'coach'
        OR lower(coalesce(auth.jwt() ->> 'email', '')) = 'mathieu.lequint@gmail.com'
      )
  )
);

CREATE POLICY "AI messages can be deleted only in allowed conversations"
ON public.ai_messages
FOR DELETE TO authenticated
USING (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1
    FROM public.ai_conversations c
    WHERE c.id = conversation_id
      AND c.user_id = auth.uid()
      AND (
        c.agent_type = 'coach'
        OR lower(coalesce(auth.jwt() ->> 'email', '')) = 'mathieu.lequint@gmail.com'
      )
  )
);
