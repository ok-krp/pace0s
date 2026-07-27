import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
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
import { springSoft, springSnap, interactiveRing } from "@/lib/motion";

const MotionLink = motion(Link);

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

const NavLink = memo(function NavLink({ to, active, onNavigate }: { to: NavItemKey; active: boolean; onNavigate?: () => void }) {
  const it = NAV_REGISTRY[to];
  if (!it) return null;
  const Icon = it.icon;
  return (
    <MotionLink
      to={to}
      onClick={onNavigate}
      whileHover={{ x: 2 }}
      whileTap={{ scale: 0.97 }}
      transition={springSnap}
      className={`group flex items-center gap-3 px-3 py-2 rounded-xl text-sm will-change-transform transition-[background,box-shadow,color] duration-300 ${interactiveRing} ${
        active
          ? "text-foreground font-medium bg-[rgb(var(--glass-tint)/calc(var(--glass-tint-strength)+0.12))] shadow-[inset_0_1px_0_0_color-mix(in_oklab,white_calc(var(--glass-edge)*60%),transparent),0_0_0_1px_color-mix(in_oklab,var(--primary)_18%,transparent),0_6px_18px_-10px_color-mix(in_oklab,var(--primary)_60%,transparent)]"
          : "text-muted-foreground hover:text-foreground hover:bg-[rgb(var(--glass-tint)/calc(var(--glass-tint-strength)*0.45))]"
      }`}
    >
      <Icon className={`size-4 ${active ? "text-primary" : ""}`} />
      <span>{it.label}</span>
    </MotionLink>
  );
});


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
            <CollapsibleTrigger className={`w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground rounded-lg ${interactiveRing}`}>
              <span>{g.label}</span>
              <motion.span animate={{ rotate: open ? 180 : 0 }} transition={springSoft} className="inline-flex">
                <ChevronDown className="size-3" />
              </motion.span>
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
        <SheetTrigger asChild>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.9 }}
            transition={springSnap}
            className={`size-10 grid place-items-center rounded-xl hover:bg-muted will-change-transform ${interactiveRing}`}
            aria-label="Menu"
          >
            <Menu className="size-5" />
          </motion.button>
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
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 pointer-events-none">
      <div className="glass-card pointer-events-auto mx-auto max-w-md px-2 py-1.5">
        <div className="flex gap-1 overflow-x-auto scrollbar-none">
          {bottom.map((to) => {
            const it = NAV_REGISTRY[to];
            if (!it) return null;
            const active = path === to;
            const Icon = it.icon;
            return (
              <MotionLink
                key={to}
                to={to}
                whileHover={{ y: -2, scale: 1.05 }}
                whileTap={{ scale: 0.92 }}
                transition={springSnap}
                className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-2xl text-[10px] shrink-0 min-w-[58px] will-change-transform ${interactiveRing} ${
                  active
                    ? "text-primary bg-[color-mix(in_oklab,var(--primary)_14%,transparent)]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="size-5 shrink-0" />
                <span className="truncate max-w-full">{it.label}</span>
              </MotionLink>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
