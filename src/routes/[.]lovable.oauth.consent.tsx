import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type AuthorizationDetails = {
  client?: { name?: string; redirect_uri?: string } | null;
  redirect_url?: string;
  redirect_to?: string;
  scopes?: string[];
} | null;

type OAuthNamespace = {
  getAuthorizationDetails: (id: string) => Promise<{ data: AuthorizationDetails; error: Error | null }>;
  approveAuthorization: (id: string) => Promise<{ data: { redirect_url?: string; redirect_to?: string } | null; error: Error | null }>;
  denyAuthorization: (id: string) => Promise<{ data: { redirect_url?: string; redirect_to?: string } | null; error: Error | null }>;
};

function oauthApi(): OAuthNamespace {
  return (supabase.auth as unknown as { oauth: OAuthNamespace }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    const next = location.pathname + location.searchStr;
    if (!data.session) throw redirect({ to: "/login", search: { next } });
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauthApi().getAuthorizationDetails(authorizationId);
    if (error) throw error;
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="glass-card rounded-2xl p-6 max-w-md text-center">
        <h1 className="text-lg font-semibold mb-2">Autorisation impossible</h1>
        <p className="text-sm text-muted-foreground">
          {String((error as Error)?.message ?? error)}
        </p>
      </div>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const api = oauthApi();
    const { data, error } = approve
      ? await api.approveAuthorization(authorization_id)
      : await api.denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("Aucune URL de redirection reçue.");
      return;
    }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? "une application";

  return (
    <main className="min-h-screen grid place-items-center p-6 pace-bg">
      <div className="glass-card rounded-2xl p-8 max-w-md w-full">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Connecter {clientName} à Pace
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {clientName} pourra utiliser les outils Pace en votre nom, avec vos permissions.
          Vos données restent protégées par les règles d'accès (RLS) de Pace.
        </p>
        {details?.scopes?.length ? (
          <div className="mt-4 text-xs text-muted-foreground">
            <div className="font-medium mb-1">Autorisations demandées :</div>
            <ul className="list-disc pl-4 space-y-0.5">
              {details.scopes.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-500">
            {error}
          </p>
        )}
        <div className="mt-6 flex gap-2">
          <Button
            disabled={busy}
            onClick={() => decide(true)}
            className="flex-1 rounded-xl"
          >
            Approuver
          </Button>
          <Button
            disabled={busy}
            variant="outline"
            onClick={() => decide(false)}
            className="flex-1 rounded-xl"
          >
            Refuser
          </Button>
        </div>
      </div>
    </main>
  );
}
