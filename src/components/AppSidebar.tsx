import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { memo, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { LayoutDashboard, Moon, Apple, Scale, Briefcase, Calendar, Wallet, Settings, Sparkles, User as UserIcon, Menu, Dumbbell, AlertTriangle, ChevronDown, Wrench, History, Search, Watch, ShoppingCart } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useNavPrefs, type NavItemKey } from "@/hooks/use-nav-prefs";
import { useLocalState } from "@/lib/storage";
import { springSoft, springSnap, interactiveRing } from "@/lib/motion";

const MotionLink = motion(Link);

export const NAV_REGISTRY: Record<NavItemKey, { label: string; icon: typeof LayoutDashboard }> = {
  "/": { label: "Dashboard", icon: LayoutDashboard },
  "/assistant": { label: "Assistant IA", icon: Sparkles },
  "/development": { label: "Développement", icon: Wrench },
  "/ai-activity": { label: "Actions IA", icon: History },
  "/nutrition": { label: "Nutrition", icon: Apple },
  "/courses": { label: "Courses", icon: ShoppingCart },
  "/sport": { label: "Sport", icon: Dumbbell },
  "/watch": { label: "Montre", icon: Watch },
  "/sleep": { label: "Sommeil", icon: Moon },
  "/routine": { label: "Routine", icon: Moon },
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
  { id: "assistant", label: "Intelligence Artificielle", items: ["/assistant", "/development", "/ai-activity"] },
  { id: "nutrition", label: "Nutrition", items: ["/nutrition", "/courses"] },
  { id: "activite", label: "Activité", items: ["/body", "/sport", "/watch", "/sleep", "/calendar", "/work"] },
  { id: "finance", label: "Finance", items: ["/finance"] },
];

const getNavItem = (key: string) => NAV_REGISTRY[key as NavItemKey];

const NavLink = memo(function NavLink({
  to,
  active,
  mobileNative = false,
}: {
  to: NavItemKey;
  active: boolean;
  mobileNative?: boolean;
}) {
  const it = getNavItem(to);
  const navigate = useNavigate();
  if (!it) return null;
  const Icon = it.icon;
  const className = `group flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-[background,box-shadow,color] duration-300 ${interactiveRing} ${active ? "text-foreground font-medium bg-[rgb(var(--glass-tint)/calc(var(--glass-tint-strength)+0.16))] shadow-[inset_0_1px_0_0_color-mix(in_oklab,white_calc(var(--glass-edge)*55%),transparent),0_0_0_1px_color-mix(in_oklab,var(--primary)_14%,transparent),0_6px_18px_-12px_color-mix(in_oklab,var(--primary)_50%,transparent)]" : "text-muted-foreground hover:text-foreground hover:bg-[rgb(var(--glass-tint)/calc(var(--glass-tint-strength)*0.5))]"}`;

  if (mobileNative) {
    return (
      <a
        href={to}
        data-nav-to={to}
        className={className}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void navigate({ to });
        }}
      >
        <Icon className={`size-4 shrink-0 ${active ? "text-primary" : ""}`} />
        <span>{it.label}</span>
      </a>
    );
  }

  return (
    <MotionLink
      to={to}
      whileHover={{ x: 2 }}
      transition={springSnap}
      className={className}
    >
      <Icon className={`size-4 shrink-0 ${active ? "text-primary" : ""}`} />
      <span>{it.label}</span>
    </MotionLink>
  );
});

function GroupedNav({ currentPath, mobileNative = false }: { currentPath: string; mobileNative?: boolean }) {
  const [openMap, setOpenMap] = useLocalState<Record<string, boolean>>("pace.sidebar.groups", {
    assistant: true,
    nutrition: true,
    activite: true,
    finance: true,
  });
  const [recallCount] = useLocalState<number>("pace.recalls.count", 0);
  const { visibleOrder } = useNavPrefs();
  const visibleSet = new Set(visibleOrder);

  return (
    <nav className="flex flex-col gap-0.5" aria-label="Navigation principale">
      <NavLink to="/" active={currentPath === "/"} mobileNative={mobileNative} />
      {GROUPS.map((g) => {
        const items = g.items.filter((to) => visibleSet.has(to));
        if (!items.length) return null;
        const hasActive = items.includes(currentPath as NavItemKey);
        const open = openMap[g.id] ?? hasActive;
        return (
          <Collapsible
            key={g.id}
            open={open}
            onOpenChange={(v) => setOpenMap((p) => ({ ...p, [g.id]: v }))}
            className="mt-3 pt-3 border-t border-[color-mix(in_oklab,white_calc(var(--glass-edge)*30%),transparent)]"
          >
            <CollapsibleTrigger className={`w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground rounded-md transition-colors duration-300 ${interactiveRing}`}>
              <span>{g.label}</span>
              <motion.span animate={{ rotate: open ? 180 : 0 }} transition={springSoft} className="inline-flex">
                <ChevronDown className="size-3" />
              </motion.span>
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-0.5 mt-0.5">
              {items.map((to) => (
                <NavLink key={to} to={to} active={currentPath === to} mobileNative={mobileNative} />
              ))}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </nav>
  );
}

function BottomNav({ currentPath, mobileNative = false }: { currentPath: string; mobileNative?: boolean }) {
  return (
    <div className="mt-auto pt-4 border-t border-[color-mix(in_oklab,white_calc(var(--glass-edge)*30%),transparent)] space-y-0.5">
      <NavLink to="/profile" active={currentPath === "/profile"} mobileNative={mobileNative} />
      <NavLink to="/settings" active={currentPath === "/settings"} mobileNative={mobileNative} />
    </div>
  );
}

export function AppSidebar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <aside className="fixed left-3 top-3 bottom-3 z-[100] hidden md:flex w-72 min-h-0 flex-none flex-col overflow-hidden px-3 py-5 glass-card rounded-[20px] isolate">
      <Link to="/" search={{}} className="flex-none flex items-center gap-2 px-3 py-2 mb-4">
        <div className="size-8 grid place-items-center text-primary"><Sparkles className="size-4" /></div>
        <div><div className="font-display font-semibold text-[15px] tracking-tight">Pace</div><div className="text-[11px] text-muted-foreground -mt-0.5">centre de contrôle</div></div>
      </Link>
      <button onClick={() => window.dispatchEvent(new Event("pace.command-palette.open"))} className="flex-none flex items-center gap-2 px-3 py-2 mb-3 rounded-md glass-thin text-sm text-muted-foreground hover:text-foreground transition">
        <Search className="size-3.5" /><span className="flex-1 text-left">Rechercher…</span><kbd className="text-[10px] px-1.5 py-0.5 rounded bg-muted font-mono">⌘K</kbd>
      </button>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain"><GroupedNav currentPath={path} /></div>
      <BottomNav currentPath={path} />
      <div className="flex-none px-3 pt-3 text-[11px] text-muted-foreground">v2 · cloud sync</div>
    </aside>
  );
}

export function MobileTopBar() {
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const current = getNavItem(path)?.label ?? "Pace";

  useEffect(() => {
    if (open) setOpen(false);
  }, [path]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const goTo = (to: NavItemKey) => {
    setOpen(false);
    void navigate({ to });
  };

  return (
    <header className="md:hidden sticky top-0 z-50 flex items-center gap-2 mx-3 mt-[max(0.5rem,env(safe-area-inset-top))] mb-1 px-3 py-2 glass-card rounded-[18px]">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`relative z-[70] size-10 will-change-transform ${interactiveRing}`}
        aria-label="Ouvrir le menu"
        aria-expanded={open}
        aria-controls="pace-mobile-sidebar"
      >
        <Menu className="size-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[1000]" role="presentation">
          <button
            type="button"
            aria-label="Fermer le menu"
            className="absolute inset-0 bg-slate-950/20 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />
          <aside
            id="pace-mobile-sidebar"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation principale"
            className="absolute inset-y-0 left-0 z-[1001] flex h-[100dvh] w-[min(88vw,360px)] flex-col overflow-hidden rounded-r-[28px] border-r border-white/20 bg-[rgb(var(--glass-tint)/calc(var(--glass-tint-strength)+0.04))] p-4 shadow-[var(--glass-elev-3)] backdrop-blur-[var(--glass-blur)] backdrop-saturate-[var(--glass-saturate)]"
          >
            <div className="flex-none flex items-center justify-between gap-2 px-1 py-1 mb-3">
              <button
                type="button"
                onClick={() => goTo("/")}
                className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
              >
                <div className="size-8 grid place-items-center text-primary"><Sparkles className="size-4" /></div>
                <div className="min-w-0">
                  <div className="font-display font-semibold text-[15px]">Pace</div>
                  <div className="text-[11px] text-muted-foreground">centre de contrôle</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={`glass-icon size-9 shrink-0 ${interactiveRing}`}
                aria-label="Fermer le menu"
              >
                <span className="text-xl leading-none" aria-hidden="true">×</span>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pointer-events-auto pr-1">
              <GroupedNav currentPath={path} mobileNative />
            </div>

            <div className="flex-none">
              <BottomNav currentPath={path} mobileNative />
            </div>
          </aside>
        </div>
      )}

      <div className="flex-1 font-display font-semibold truncate">{current}</div>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("pace.command-palette.open"))}
        aria-label="Rechercher"
        className={`size-10 will-change-transform ${interactiveRing}`}
      >
        <Search className="size-4" />
      </button>
    </header>
  );
}

export function MobileTabBar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { bottom } = useNavPrefs();
  if (!bottom.length) return null;
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 pointer-events-none">
      <div className="glass-card pointer-events-auto mx-auto max-w-md px-2 py-1.5">
        <div className="flex gap-1 overflow-x-auto scrollbar-none">
          {bottom.map((to) => {
            const it = getNavItem(to);
            if (!it) return null;
            const active = path === to;
            const Icon = it.icon;
            const className = `flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-md text-[10px] shrink-0 min-w-[58px] will-change-transform ${interactiveRing} ${active ? "text-primary bg-[color-mix(in_oklab,var(--primary)_14%,transparent)]" : "text-muted-foreground hover:text-foreground"}`;
            return <MotionLink key={to} to={to} whileHover={{ y: -2, scale: 1.05 }} transition={springSnap} className={className}><Icon className="size-5 shrink-0" /><span className="truncate max-w-full">{it.label}</span></MotionLink>;
          })}
        </div>
      </div>
    </nav>
  );
}
