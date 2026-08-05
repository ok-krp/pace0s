import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, XCircle } from "lucide-react";
import { PageHeader } from "@/components/Stat";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/ai-activity")({
  head: () => ({ meta: [{ title: "Actions IA — Pace" }, { name: "description", content: "Journal transparent des actions réalisées par Coach IA et BUILD IA." }, { property: "og:title", content: "Actions IA — Pace" }, { property: "og:description", content: "Journal transparent des actions réalisées par les assistants Pace." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: AiActivityPage,
});

type ActionRow = { id: string; agent_type: string; label: string; status: string; created_at: string; error_message: string | null };

function AiActivityPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<ActionRow[]>([]);
  useEffect(() => {
    if (!user) return;
    void supabase.from("ai_action_log").select("id,agent_type,label,status,created_at,error_message").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100).then(({ data }) => setRows(data ?? []));
  }, [user]);
  return (
    <div>
      <PageHeader title="Historique des actions IA" subtitle="Chaque modification reste visible et vérifiable." />
      <div className="space-y-2">
        {rows.length === 0 && <div className="glass-card rounded-2xl p-8 text-center text-sm text-muted-foreground">Aucune action réalisée.</div>}
        {rows.map((row) => {
          const Icon = row.status === "executed" ? CheckCircle2 : row.status === "failed" ? XCircle : Clock3;
          return <div key={row.id} className="glass-card rounded-2xl px-4 py-3 flex items-center gap-3"><Icon className={`size-5 ${row.status === "executed" ? "text-emerald-500" : row.status === "failed" ? "text-destructive" : "text-amber-500"}`} /><div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{row.label}</div><div className="text-xs text-muted-foreground">{row.agent_type === "coach" ? "Coach IA" : "BUILD IA"} · {new Date(row.created_at).toLocaleString("fr-FR")}</div>{row.error_message && <div className="text-xs text-destructive mt-1">{row.error_message}</div>}</div></div>;
        })}
      </div>
    </div>
  );
}