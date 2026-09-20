import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { switchLocalAccountScope } from "@/lib/account-scope";

type AuthCtx = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({ user: null, session: null, loading: true, signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [scopeReady, setScopeReady] = useState(false);

  useEffect(() => {
    let disposed = false;

    const applySession = (nextSession: Session | null) => {
      if (disposed) return;
      switchLocalAccountScope(nextSession?.user.id ?? null);
      setSession(nextSession);
      setScopeReady(true);
      setLoading(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      applySession(nextSession);
    });

    supabase.auth.getSession().then(({ data }) => {
      applySession(data.session);
    });

    return () => {
      disposed = true;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <Ctx.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading: loading || !scopeReady,
        signOut: async () => { await supabase.auth.signOut(); },
      }}
    >
      {scopeReady ? children : null}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
