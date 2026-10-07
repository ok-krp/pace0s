import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function describeOAuthError(url: URL): string | null {
  const error = url.searchParams.get("error");
  if (!error) return null;
  const description = url.searchParams.get("error_description");
  const code = url.searchParams.get("error_code");
  return [description, code ? `(${code})` : null, `[${error}]`]
    .filter(Boolean)
    .join(" ");
}

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const completeOAuth = async () => {
      const url = new URL(window.location.href);
      const next = safeNext(url.searchParams.get("next"));
      const providerError = describeOAuthError(url);

      if (providerError) {
        throw new Error(`Google OAuth a échoué : ${providerError}`);
      }

      const code = url.searchParams.get("code");

      if (code) {
        const { error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) throw exchangeError;
      } else {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!data.session) {
          throw new Error(
            "Retour OAuth reçu sans code PKCE ni session. Vérifiez la réponse de Google/Supabase.",
          );
        }
      }

      if (cancelled) return;
      window.history.replaceState({}, document.title, "/auth/callback");
      window.location.assign(next);
    };

    completeOAuth().catch((reason) => {
      if (cancelled) return;
      console.error("[Auth] OAuth callback failed", reason);
      setError(reason instanceof Error ? reason.message : String(reason));
    });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen grid place-items-center px-4 bg-background">
        <div className="w-full max-w-md rounded-2xl glass-card p-6 text-center">
          <h1 className="font-display text-xl font-semibold">
            Connexion Google impossible
          </h1>
          <p className="text-sm text-muted-foreground mt-2 break-words">{error}</p>
          <Button
            className="mt-6 w-full"
            onClick={() => window.location.assign("/login")}
          >
            Retour à la connexion
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid place-items-center bg-background">
      <div className="size-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
    </div>
  );
}
