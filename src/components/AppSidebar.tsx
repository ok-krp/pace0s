import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import {
  LayoutDashboard,
  Moon,
  Repeat,
  Apple,
  Scale,
  Briefcase,
  Calendar,
  Wallet,
  BarChart3,
  Settings,
  Sparkles,
  User as UserIcon,
  Menu,
  Dumbbell,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useNavPrefs, type NavItemKey } from "@/hooks/use-nav-prefs";
import { useLocalState } from "@/lib/storage";

export const NAV_REGISTRY: Record<NavItemKey, { label: string; icon: typeof LayoutDashboard }> = {
  "/": { label: "Dashboard", icon: LayoutDashboard },
  "/nutrition": { label: "Nutrition", icon: Apple },
  "/sport": { label: "Sport", icon: Dumbbell },
  "/sleep": { label: "Sommeil", icon: Moon },
  "/routine": { label: "Routine", icon: Repeat },
  "/body": { label: "Poids & Corps", icon: Scale },
  "/work": { label: "Travail", icon: Briefcase },
  "/calendar": { label: "Calendrier", icon: Calendar },
  "/recalls": { label: "Rappels conso", icon: AlertTriangle },
  "/finance": { label: "Finance & Invest.", icon: Wallet },
  "/stats": { label: "Statistiques", icon: BarChart3 },
  "/profile": { label: "Profil", icon: UserIcon },
  "/settings": { label: "Paramètres", icon: Settings },
};

type Group = { id: string; label: string; items: NavItemKey[] };

const GROUPS: Group[] = [
  { id: "nutrition", label: "Nutrition", items: ["/nutrition", "/recalls"] },
  { id: "activite", label: "Activité", items: ["/body", "/sport", "/sleep", "/calendar", "/routine", "/work"] },
  { id: "finance", label: "Finance", items: ["/finance"] },
  { id: "autres", label: "Autres", items: ["/stats", "/profile", "/settings"] },
];

function NavLink({ to, active, onNavigate }: { to: NavItemKey; active: boolean; onNavigate?: () => void }) {
  const it = NAV_REGISTRY[to];
  if (!it) return null;
  const Icon = it.icon;
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={`group flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-[var(--shadow-soft)]"
          : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60"
      }`}
    >
      <Icon className={`size-4 ${active ? "text-primary" : ""}`} />
      <span>{it.label}</span>
    </Link>
  );
}

function GroupedNav({ currentPath, onNavigate }: { currentPath: string; onNavigate?: () => void }) {
  const [openMap, setOpenMap] = useLocalState<Record<string, boolean>>("lt.sidebar.groups", {
    nutrition: true, activite: true, finance: true, autres: false,
  });
  return (
    <nav className="flex flex-col gap-0.5">
      <NavLink to="/" active={currentPath === "/"} onNavigate={onNavigate} />
      {GROUPS.map((g) => {
        const hasActive = g.items.includes(currentPath as NavItemKey);
        const open = openMap[g.id] ?? hasActive;
        return (
          <Collapsible
            key={g.id}
            open={open}
            onOpenChange={(v) => setOpenMap((p) => ({ ...p, [g.id]: v }))}
            className="mt-1"
          >
            <CollapsibleTrigger className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground rounded-lg">
              <span>{g.label}</span>
              <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-0.5 mt-0.5">
              {g.items.map((to) => (
                <NavLink key={to} to={to} active={currentPath === to} onNavigate={onNavigate} />
              ))}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </nav>
  );
}

export function AppSidebar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <aside className="hidden md:flex flex-col w-60 shrink-0 h-screen sticky top-0 px-3 py-5 border-r border-white/20 dark:border-white/10 bg-[color-mix(in_oklab,var(--sidebar)_55%,transparent)] backdrop-blur-2xl backdrop-saturate-150">
      <Link to="/" className="flex items-center gap-2 px-3 py-2 mb-4">
        <div className="size-8 rounded-xl stat-grad grid place-items-center text-primary-foreground shadow-[var(--shadow-glow)]">
          <Sparkles className="size-4" />
        </div>
        <div>
          <div className="font-display font-semibold text-[15px] tracking-tight">Pace</div>
          <div className="text-[11px] text-muted-foreground -mt-0.5">centre de contrôle</div>
        </div>
      </Link>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <GroupedNav currentPath={path} />
      </div>
      <div className="px-3 pt-4 text-[11px] text-muted-foreground">v2 · cloud sync</div>
    </aside>
  );
}

export function MobileTopBar() {
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const current = NAV_REGISTRY[path as NavItemKey]?.label ?? "Pace";
  return (
    <header className="md:hidden sticky top-0 z-40 flex items-center gap-2 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] border-b border-white/20 dark:border-white/10 bg-[color-mix(in_oklab,var(--background)_55%,transparent)] backdrop-blur-2xl backdrop-saturate-150">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger className="size-10 grid place-items-center rounded-lg hover:bg-muted transition-colors" aria-label="Menu">
          <Menu className="size-5" />
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-4 flex flex-col">
          <Link to="/" onClick={() => setOpen(false)} className="flex items-center gap-2 px-1 py-2 mb-3">
            <div className="size-8 rounded-xl stat-grad grid place-items-center text-primary-foreground">
              <Sparkles className="size-4" />
            </div>
            <div className="font-display font-semibold text-[15px]">Pace</div>
          </Link>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <GroupedNav currentPath={path} onNavigate={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
      <div className="flex-1 font-display font-semibold truncate">{current}</div>
    </header>
  );
}

export function MobileTabBar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { bottom } = useNavPrefs();
  if (bottom.length === 0) return null;
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 glass border-t border-border pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="flex gap-1 overflow-x-auto scrollbar-none px-2">
        {bottom.map((to) => {
          const it = NAV_REGISTRY[to];
          if (!it) return null;
          const active = path === to;
          const Icon = it.icon;
          return (
            <Link
              key={to}
              to={to}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-[10px] transition-colors shrink-0 min-w-[58px] ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className="size-5 shrink-0" />
              <span className="truncate max-w-full">{it.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
