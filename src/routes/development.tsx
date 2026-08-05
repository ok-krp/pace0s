import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bug, Lightbulb, ListChecks } from "lucide-react";
import { PageHeader } from "@/components/Stat";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/development")({
  head: () => ({ meta: [{ title: "Développement — Pace" }, { name: "description", content: "Bugs, améliorations et fonctionnalités structurés par BUILD IA." }, { property: "og:title", content: "Développement — Pace" }, { property: "og:description", content: "Centre de suivi du développement de Pace." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: DevelopmentPage,
});

type Task = { id: string; kind: string; title: string; description: string; priority: string; status: string };
function DevelopmentPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  useEffect(() => { if (user) void supabase.from("development_tasks").select("id,kind,title,description,priority,status").eq("user_id", user.id).order("updated_at", { ascending: false }).then(({ data }) => setTasks(data ?? [])); }, [user]);
  return <div><PageHeader title="Développement" subtitle="La feuille de route structurée par BUILD IA." /><div className="grid md:grid-cols-2 gap-3">{tasks.length === 0 && <div className="glass-card rounded-2xl p-8 text-sm text-muted-foreground md:col-span-2">Demandez à BUILD IA de créer un bug ou une amélioration.</div>}{tasks.map((task) => { const Icon = task.kind === "bug" ? Bug : task.kind === "improvement" ? Lightbulb : ListChecks; return <article key={task.id} className="glass-card rounded-2xl p-4"><div className="flex items-start gap-3"><span className="glass-icon size-9"><Icon className="size-4" /></span><div className="min-w-0"><div className="font-medium">{task.title}</div><div className="text-xs text-muted-foreground uppercase mt-0.5">{task.kind} · {task.priority} · {task.status}</div><p className="text-sm text-muted-foreground mt-2">{task.description}</p></div></div></article>; })}</div></div>;
}