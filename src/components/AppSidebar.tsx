import { Link, useRouterState } from "@tanstack/react-router";
import { memo, useState } from "react";
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
  "/assistant": { label: "Assistant IA", icon: Sparkles },
  "/nutrition": { label: "Nutrition", icon: Apple },
  "/sport": { label: "Sport", icon: Dumbbell },
  "/sleep": { label: "Sommeil", icon: Moon },
  "/routine": { label: "Routine", icon: Repeat },
  "/body": { label: "Poids & Corps", icon: Scale },
  "/work": { label: "Travail", icon: Briefcase },
  "/calendar": { label: "Calendrier", icon: Calendar },
  "/recalls": { label: "Rappels conso", icon: AlertTriangle },
  "/finance": { label: "Finance & Invest.", icon: Wallet },
  "/profile": { label: "Profil", icon: UserIcon },
  "/settings": { label: "Paramètres", icon: Settings },
};

type Group = { id: string; label: string; items: NavItemKey[] };

const GROUPS: Group[] = [
  { id: "assistant", label: "Assistant", items: ["/assistant"] },
  // Nutrition et Rappels conso sont fusionnés en une seule carte de navigation.
  { id: "nutrition", label: "Nutrition", items: ["/nutrition"] },
  { id: "activite", label: "Activité", items: ["/body", "/sport", "/sleep", "/calendar", "/routine", "/work"] },
  { id: "finance", label: "Finance", items: ["/finance"] },
  { id: "autres", label: "Autres", items: ["/profile", "/settings"] },
];

const NavLink = memo(function NavLink({ to, active, onNavigate, alert }: { to: NavItemKey; active: boolean; onNavigate?: () => void; alert?: number }) {
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
      className={`group flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-[background,box-shadow,color] duration-300 ${interactiveRing} ${
        active
          ? "text-foreground font-medium bg-[rgb(var(--glass-tint)/calc(var(--glass-tint-strength)+0.16))] shadow-[inset_0_1px_0_0_color-mix(in_oklab,white_calc(var(--glass-edge)*55%),transparent),0_0_0_1px_color-mix(in_oklab,var(--primary)_14%,transparent),0_6px_18px_-12px_color-mix(in_oklab,var(--primary)_50%,transparent)]"
          : "text-muted-foreground hover:text-foreground hover:bg-[rgb(var(--glass-tint)/calc(var(--glass-tint-strength)*0.5))]"
      }`}
    >
      <span className="glass-icon size-8 shrink-0 relative">
        <Icon className={`size-4 ${active ? "text-primary" : ""}`} />
        {!!alert && (
          <span
            aria-label={`${alert} rappel${alert > 1 ? "s" : ""} conso`}
            className="absolute -top-1 -right-1 size-4 rounded-full grid place-items-center bg-rose-500 text-white shadow-[0_2px_6px_-1px_rgba(0,0,0,0.4)] ring-1 ring-white/40"
          >
            <AlertTriangle className="size-2.5" />
          </span>
        )}
      </span>
      <span>{it.label}</span>
    </MotionLink>
  );
});


function GroupedNav({ currentPath, onNavigate }: { currentPath: string; onNavigate?: () => void }) {
  const [openMap, setOpenMap] = useLocalState<Record<string, boolean>>("lt.sidebar.groups", {
    assistant: true, nutrition: true, activite: true, finance: true, autres: false,
  });
  const [recallCount] = useLocalState<number>("lt.recalls.count", 0);
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
            className="mt-3 pt-3 border-t border-[color-mix(in_oklab,white_calc(var(--glass-edge)*30%),transparent)]"
          >
            <CollapsibleTrigger className={`w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground rounded-lg transition-colors duration-300 ${interactiveRing}`}>

              <span>{g.label}</span>
              <motion.span animate={{ rotate: open ? 180 : 0 }} transition={springSoft} className="inline-flex">
                <ChevronDown className="size-3" />
              </motion.span>
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-0.5 mt-0.5">
              {g.items.map((to) => (
                <NavLink key={to} to={to} active={currentPath === to} onNavigate={onNavigate} alert={to === "/nutrition" ? recallCount : 0} />
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
    <aside className="hidden md:flex flex-col w-60 shrink-0 h-[calc(100vh-1.5rem)] sticky top-3 ml-3 my-3 px-3 py-5 glass-card rounded-[28px]">
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
    <header className="md:hidden sticky top-0 z-40 flex items-center gap-2 mx-3 mt-[max(0.5rem,env(safe-area-inset-top))] mb-1 px-3 py-2 glass-card rounded-[22px]">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.9 }}
            transition={springSnap}
            className={`glass-icon size-10 will-change-transform ${interactiveRing}`}

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
                <span className="glass-icon size-8 shrink-0"><Icon className="size-5 shrink-0" /></span>
                <span className="truncate max-w-full">{it.label}</span>
              </MotionLink>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
