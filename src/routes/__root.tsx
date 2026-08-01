import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  useNavigate,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect } from "react";

import appCss from "../styles.css?url";
import { AppSidebar, MobileTabBar, MobileTopBar } from "@/components/AppSidebar";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { LegalConsentGate } from "@/components/LegalConsentGate";
import { GlobalErrorBoundary } from "@/components/GlobalErrorBoundary";
import { applyWallpaper, readWallpaperChoice } from "@/hooks/use-wallpaper";
import { useGlassPointer } from "@/hooks/use-glass-pointer";
import { applyGlassQuality, readGlassQuality } from "@/hooks/use-glass-quality";


function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-7xl font-semibold tracking-tight">404</h1>
        <p className="mt-2 text-muted-foreground">Cette page n'existe pas.</p>
        <Link to="/" className="mt-6 inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Retour au dashboard
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-xl font-semibold">Une erreur est survenue</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-6 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Réessayer
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Pace" },
      { name: "description", content: "Score quotidien, calories, eau, sommeil, finances, productivité — tout en un coup d'œil." },
      { name: "theme-color", content: "#f8fafc" },
      { property: "og:title", content: "Pace" },
      { name: "twitter:title", content: "Pace" },
      { property: "og:description", content: "Score quotidien, calories, eau, sommeil, finances, productivité — tout en un coup d'œil." },
      { name: "twitter:description", content: "Score quotidien, calories, eau, sommeil, finances, productivité — tout en un coup d'œil." },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/c5e32b18-bb82-4335-acca-3734bf96e117/id-preview-3e5bec36--7fdf2e74-b469-427a-9a0f-822afd78e57b.lovable.app-1785058212125.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/c5e32b18-bb82-4335-acca-3734bf96e117/id-preview-3e5bec36--7fdf2e74-b469-427a-9a0f-822afd78e57b.lovable.app-1785058212125.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.json" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
      { rel: "icon", href: "/icon-192.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Figtree:wght@400;500;600&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <GlobalErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthGate />
        </AuthProvider>
      </QueryClientProvider>
    </GlobalErrorBoundary>
  );
}


const PUBLIC_ROUTES = ["/login"];

function AuthGate() {
  const { user, loading } = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const isPublic = PUBLIC_ROUTES.includes(path);

  // Single rAF-throttled pointer loop powering every glass specular highlight.
  useGlassPointer();

  useEffect(() => {
    // Apply wallpaper + adaptive glass tint on mount and when dark mode toggles.
    applyGlassQuality(readGlassQuality());
    applyWallpaper(readWallpaperChoice());
    const obs = new MutationObserver(() => applyWallpaper(readWallpaperChoice()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user && !isPublic) {
      const next = path + (typeof window !== "undefined" ? window.location.search : "");
      navigate({ to: "/login", search: { next } });
    }
  }, [user, loading, isPublic, navigate, path]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="size-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </div>
    );
  }

  if (isPublic || !user) {
    return (
      <>
        <Outlet />
        <Toaster />
      </>
    );
  }

  return (
    <div className="min-h-screen flex pace-bg">
      <AppSidebar />
      <main className="flex-1 min-w-0 pb-24 md:pb-8 flex flex-col">
        <MobileTopBar />
        <div className="max-w-6xl w-full mx-auto px-4 md:px-8 pt-4 md:pt-10">
          <Outlet />
        </div>
      </main>
      <MobileTabBar />
      <LegalConsentGate />
      <Toaster />
    </div>
  );
}
