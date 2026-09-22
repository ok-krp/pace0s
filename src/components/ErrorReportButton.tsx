import { useEffect, useState } from "react";
import { Bug, Check, X } from "lucide-react";
import { getSafeClientErrorMessage } from "@/lib/client-error";

type ErrorReportButtonProps = {
  error: unknown;
  context?: string;
};

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return { message: getSafeClientErrorMessage(error), name: error.name, stack: error.stack };
  }
  return { message: getSafeClientErrorMessage(error), name: "UnknownError", stack: undefined };
}

export function ErrorReportButton({ error, context = "unknown" }: ErrorReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [details, setDetails] = useState("");

  const report = async () => {
    setStatus("sending");
    const normalized = normalizeError(error);
    try {
      const response = await fetch("/api/error-report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...normalized,
          context,
          url: window.location.href,
          pathname: window.location.pathname,
          visualTheme: document.documentElement.dataset.visualTheme || "pace",
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString(),
          details: details.trim().slice(0, 1000),
        }),
        keepalive: true,
      });
      if (!response.ok) throw new Error("Report failed");
      setStatus("sent");
    } catch (reportError) {
      console.error("[PaceErrorReporter]", reportError);
      setStatus("failed");
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background/80 px-3 py-2 text-xs font-medium text-foreground"
      >
        <Bug className="size-3.5" /> Signaler
      </button>
    );
  }

  return (
    <div className="mt-3 w-full text-left">
      <div className="border border-border bg-background p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium">Signaler ce problème</p>
          <button type="button" onClick={() => setOpen(false)} aria-label="Fermer" className="p-1">
            <X className="size-3.5" />
          </button>
        </div>
        <textarea
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          placeholder="Décris ce que tu faisais juste avant l'erreur (facultatif)"
          className="mt-2 min-h-20 w-full border border-border bg-background p-2 text-xs"
          maxLength={1000}
        />
        <div className="mt-2 flex items-center gap-2">
          <button type="button" disabled={status === "sending" || status === "sent"} onClick={report} className="inline-flex items-center gap-2 border border-border bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-60">
            <Check className="size-3.5" /> {status === "sending" ? "Envoi…" : status === "sent" ? "Signalé" : "Envoyer"}
          </button>
          {status === "failed" && <span className="text-xs text-destructive">Envoi impossible. Réessaie.</span>}
        </div>
      </div>
    </div>
  );
}

export function GlobalErrorReporter() {
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const next = event.error instanceof Error ? event.error : new Error(event.message || "Erreur JavaScript");
      console.error("[PaceUnhandledError]", next);
      setError(next);
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const next = event.reason instanceof Error ? event.reason : new Error(String(event.reason ?? "Promise rejetée"));
      console.error("[PaceUnhandledRejection]", next);
      setError(next);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  if (!error) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[10000] max-w-[calc(100vw-2rem)]">
      <div className="border border-destructive/30 bg-background p-3 shadow-lg">
        <p className="mb-2 text-xs text-muted-foreground">Une erreur technique a été détectée.</p>
        <ErrorReportButton error={error} context="window-error" />
      </div>
    </div>
  );
}
