import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bug, Lightbulb, ListChecks, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/Stat";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/development")({
  head: () => ({ meta: [{ title: "Développement — Pace" }, { name: "description", content: "Bugs, améliorations et fonctionnalités structurés par BUILD IA." }, { property: "og:title", content: "Développement — Pace" }, { property: "og:description", content: "Centre de suivi du développement de Pace." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: DevelopmentPage,
});

type Task = { id: string; kind: string; title: string; description: string; priority: string; status: string };

function DevelopmentPage() {
  const { user, loading: authLoading } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [realtimeWarning, setRealtimeWarning] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setTasks([]); setLoading(false); setLoadError("Session non authentifiée."); return; }
    let active = true;
    const load = async () => {
      if (active) setLoading(true);
      const primary = await supabase.from("development_tasks").select("id,kind,title,description,priority,status").eq("user_id", user.id).order("updated_at", { ascending: false }).order("id", { ascending: false });
      let data = primary.data;
      let error = primary.error;
      if (error) {
        const fallback = await supabase.from("development_tasks").select("id,kind,title,description,priority,status").eq("user_id", user.id).order("id", { ascending: false });
        data = fallback.data;
        error = fallback.error;
      }
      if (!active) return;
      setLoading(false);
      if (error) {
        setLoadError(error.message || "Impossible de charger les tâches.");
        return;
      }
      setLoadError(null);
      setTasks((data ?? []) as Task[]);
    };
    void load();
    const channel = supabase.channel(`development-tasks-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "development_tasks", filter: `user_id=eq.${user.id}` }, () => { void load(); })
      .subscribe((status) => {
        if (!active) return;
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("[development] realtime tasks unavailable", status);
          setRealtimeWarning("Synchronisation temps réel indisponible ; actualisation automatique au retour sur la page.");
        } else if (status === "SUBSCRIBED") {
          setRealtimeWarning(null);
        }
      });
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [authLoading, user]);

  return <div><PageHeader title="Développement" subtitle="La feuille de route structurée par BUILD IA." /><div className="grid md:grid-cols-2 gap-3">{loadError && <div className="glass-card rounded-2xl p-4 text-sm text-destructive md:col-span-2">{loadError}</div>}{realtimeWarning && !loadError && <div className="glass-card rounded-2xl p-4 text-sm text-muted-foreground md:col-span-2">{realtimeWarning}</div>}{loading && <div className="glass-card rounded-2xl p-8 text-sm text-muted-foreground md:col-span-2 flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Chargement des tâches…</div>}{!loading && !loadError && tasks.length === 0 && <div className="glass-card rounded-2xl p-8 text-sm text-muted-foreground md:col-span-2">Demandez à BUILD IA de créer un bug ou une amélioration.</div>}{tasks.map((task) => { const Icon = task.kind === "bug" ? Bug : task.kind === "improvement" ? Lightbulb : ListChecks; return <article key={task.id} className="glass-card rounded-2xl p-4"><div className="flex items-start gap-3"><span className="glass-icon size-9"><Icon className="size-4" /></span><div className="min-w-0"><div className="font-medium">{task.title}</div><div className="text-xs text-muted-foreground uppercase mt-0.5">{task.kind} · {task.priority} · {task.status}</div><p className="text-sm text-muted-foreground mt-2">{task.description}</p></div></div></article>; })}</div></div>;
}
