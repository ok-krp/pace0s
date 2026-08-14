import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Watch } from "lucide-react";
import { WatchManager } from "@/components/WatchManager";
import { HealthConnectDiagnostics } from "@/components/HealthConnectDiagnostics";

export const Route = createFileRoute("/watch")({
  head: () => ({
    meta: [
      { title: "Montre — Pace" },
      { name: "description", content: "Connexion, données et synchronisation de ta montre." },
    ],
  }),
  component: WatchPage,
});

function WatchPage() {
  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Retour
        </Link>
        <div className="flex items-center gap-3">
          <div className="size-11 rounded-2xl bg-primary/10 grid place-items-center">
            <Watch className="size-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-semibold">Montre</h1>
            <p className="text-sm text-muted-foreground">Connexion, données et synchronisation de ta montre.</p>
          </div>
        </div>
        <WatchManager />
        <HealthConnectDiagnostics />
      </div>
    </main>
  );
}
