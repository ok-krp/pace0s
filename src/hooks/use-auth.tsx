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
  const [scopeError, setScopeError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let authEventVersion = 0;

    const applySession = (nextSession: Session | null) => {
      if (disposed) return;
      try {
        switchLocalAccountScope(nextSession?.user.id ?? null);
        setSession(nextSession);
        setScopeError(null);
        setScopeReady(true);
        setLoading(false);
      } catch (error) {
        // Fail closed: never render a previous account's local data if the
        // browser could not save/restore the corresponding local snapshot.
        setScopeError(error instanceof Error ? error.message : "Changement de compte impossible.");
        setScopeReady(false);
        setLoading(false);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      authEventVersion++;
      applySession(nextSession);
    });

    const initialVersion = authEventVersion;
    supabase.auth.getSession().then(({ data }) => {
      // A delayed initial getSession response must not overwrite a more recent
      // account transition delivered by onAuthStateChange.
      if (!disposed && authEventVersion === initialVersion) {
        applySession(data.session);
      }
    }).catch((error) => {
      if (!disposed && authEventVersion === initialVersion) {
        setScopeError(error instanceof Error ? error.message : "Session indisponible.");
        setScopeReady(false);
        setLoading(false);
      }
    });

    return () => {
      disposed = true;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <Ctx.Provider
      key={session?.user.id ?? "__guest__"}
      value={{
        user: session?.user ?? null,
        session,
        loading: loading || !scopeReady,
        signOut: async () => { await supabase.auth.signOut(); },
      }}
    >
      {scopeReady ? children : scopeError ? (
        <div role="alert" className="min-h-screen flex items-center justify-center p-6 text-sm text-center text-destructive">
          {scopeError} Recharge la page après avoir vérifié l'espace de stockage de ton navigateur.
        </div>
      ) : null}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
