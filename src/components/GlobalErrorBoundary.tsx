import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCcw, Home } from "lucide-react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class GlobalErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[GlobalErrorBoundary]", error, info.componentStack);
  }

  private handleReload = () => {
    if (typeof window !== "undefined") window.location.reload();
  };

  private handleHome = () => {
    if (typeof window !== "undefined") window.location.href = "/";
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen pace-bg grid place-items-center px-4 py-10">
        <div className="glass-card max-w-md w-full p-8 text-center">
          <div className="mx-auto size-14 rounded-2xl bg-destructive/15 text-destructive grid place-items-center">
            <AlertTriangle className="size-6" />
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight mt-5">
            Un souci est survenu
          </h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            Toutes nos excuses — quelque chose s'est mal passé. Vos données sont intactes.
            Rafraîchissez l'application ou revenez à l'accueil.
          </p>
          {this.state.error.message && (
            <p className="mt-4 text-[11px] text-muted-foreground/70 font-mono break-words px-2 py-2 rounded-lg bg-foreground/5">
              {this.state.error.message}
            </p>
          )}
          <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
            >
              <RefreshCcw className="size-4" /> Rafraîchir l'application
            </button>
            <button
              type="button"
              onClick={this.handleHome}
              className="inline-flex items-center justify-center gap-2 rounded-xl glass-card px-4 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              <Home className="size-4" /> Retour à l'accueil
            </button>
          </div>
        </div>
      </div>
    );
  }
}
