import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthCtx = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({ user: null, session: null, loading: true, signOut: async () => {} });
const AUTH_OWNER_KEY = "pace.__auth_owner";
const USER_DATA_PREFIXES = ["pace.", "lt."] as const;

function clearLocalUserData() {
  if (typeof window === "undefined") return;
  try {
    for (const key of Object.keys(localStorage)) {
      if (USER_DATA_PREFIXES.some((prefix) => key.startsWith(prefix)) && key !== AUTH_OWNER_KEY) {
        localStorage.removeItem(key);
      }
    }
  } catch {}
}

function syncLocalStorageOwner(userId: string | null) {
  if (typeof window === "undefined") return;
  try {
    const previousOwner = localStorage.getItem(AUTH_OWNER_KEY);
    if (previousOwner !== userId) clearLocalUserData();
    if (userId) localStorage.setItem(AUTH_OWNER_KEY, userId);
    else localStorage.removeItem(AUTH_OWNER_KEY);
  } catch {}
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, nextSession) => {
      syncLocalStorageOwner(nextSession?.user.id ?? null);
      setSession(nextSession);
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data }) => {
      syncLocalStorageOwner(data.session?.user.id ?? null);
      setSession(data.session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <Ctx.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        signOut: async () => {
          syncLocalStorageOwner(null);
          await supabase.auth.signOut();
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
