import { Link, useRouterState } from "@tanstack/react-router";
import { memo, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { LayoutDashboard, Moon, Apple, Scale, Briefcase, Calendar, Wallet, Settings, Sparkles, User as UserIcon, Menu, Dumbbell, AlertTriangle, ChevronDown, Wrench, History, Search, Watch, ShoppingCart } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useNavPrefs, type NavItemKey } from "@/hooks/use-nav-prefs";
import { useLocalState } from "@/lib/storage";
import { springSoft, interactiveRing } from "@/lib/motion";

const NativeNavLink = ({ to, className, children, onClick }: { to: NavItemKey; className?: string; children: React.ReactNode; onClick?: () => void }) => <Link to={to} onClick={onClick} className={className}>{children}</Link>;

export const NAV_REGISTRY: Record<NavItemKey, { label: string; icon: typeof LayoutDashboard }> = {
  "/": { label: "Accueil", icon: LayoutDashboard },
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
  "/settings": { label: "Paramètres", icon: Settings }
};

type Group = { id: string; label: string; items: NavItemKey[] };
const GROUPS: Group[] = [
  { id: "assistant", label: "Intelligence Artificielle", items: ["/assistant", "/development", "/ai-activity"] },
  { id: "nutrition", label: "Nutrition", items: ["/nutrition", "/courses"] },
  { id: "activite", label: "Activité", items: ["/body", "/sport", "/watch", "/sleep", "/calendar", "/work"] },
  { id: "finance", label: "Finance", items: ["/finance"] }
];

const getNavItem = (key: string) => NAV_REGISTRY[key as NavItemKey];

const NavLink = memo(function NavLink({ to, active, onClick }: { to: NavItemKey; active: boolean; onClick?: () => void }) {
  const it = getNavItem(to);
  if (!it) return null;
  const Icon = it.icon;
  const className = `group flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-[background,box-shadow,color] duration-300 ${interactiveRing} ${active ? "text-foreground font-medium bg-[rgb(var(--glass-tint)/calc(var(--glass-tint-strength)+0.16))] shadow-[inset_0_1px_0_0_color-mix(in_oklab,white_calc(var(--glass-edge)*55%),transparent),0_0_0_1px_color-mix(in_oklab,var(--primary)_14%,transparent),0_6px_18px_-12px_color-mix(in_oklab,var(--primary)_50%,transparent)]" : "text-muted-foreground hover:bg-[rgb(var(--glass-tint)/calc(var(--glass-tint-strength)*0.5))]" }`;
  return <NativeNavLink to={to} onClick={onClick} className={className}><Icon className={`size-4 shrink-0 ${active ? "text-primary" : ""}`} /><span>{it.label}</span></NativeNavLink>;
});

function GroupedNav({ currentPath, onNavigate }: { currentPath: string; onNavigate?: () => void }) {
  const [openMap, setOpenMap] = useLocalState<Record<string, boolean>>("pace.sidebar.groups", { assistant: true, nutrition: true, activite: true, finance: true });
  const { visibleOrder } = useNavPrefs();
  const visibleSet = new Set(visibleOrder);
  return <nav className="flex flex-col gap-0.5">
    <NavLink to="/" active={currentPath === "/"} onClick={onNavigate} />
    {GROUPS.map((g) => {
      const items = g.items.filter((to) => visibleSet.has(to));
      if (!items.length) return null;
      const hasActive = items.includes(currentPath as NavItemKey);
      const open = openMap[g.id] ?? hasActive;
      return <Collapsible key={g.id} open={open} onOpenChange={(v) => setOpenMap((p) => ({ ...p, [g.id]: v }))} className="mt-3 pt-3 border-t border-[color-mix(in_oklab,white_calc(var(--glass-edge)*30%),transparent)]">
        <CollapsibleTrigger className={`w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground rounded-md transition-colors duration-300 ${interactiveRing}`}>
          <span>{g.label}</span><motion.span animate={{ rotate: open ? 180 : 0 }} transition={springSoft} className="inline-flex"><ChevronDown className="size-3" /></motion.span>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-0.5 mt-0.5">{items.map((to) => <NavLink key={to} to={to} active={currentPath === to} onClick={onNavigate} />)}</CollapsibleContent>
      </Collapsible>;
    })}
  </nav>;
}

function SearchButton() {
  return <button onClick={() => window.dispatchEvent(new Event("pace.command-palette.open"))} className="flex-none flex items-center gap-2 px-3 py-2 mt-3 rounded-xl glass-thin border border-white/20 bg-white/10 backdrop-blur-2xl text-sm text-white/70 transition" aria-label="Rechercher">
    <Search className="size-3.5" /><span className="flex-1 text-left">Rechercher…</span><kbd className="text-[10px] px-1.5 py-0.5 rounded bg-muted font-mono">⌘K</kbd>
  </button>;
}

function BottomNav({ currentPath, onNavigate }: { currentPath: string; onNavigate?: () => void }) {
  return <div className="mt-auto pt-4 border-t border-[color-mix(in_oklab,white_calc(var(--glass-edge)*30%),transparent)] space-y-0.5">
    <NavLink to="/profile" active={currentPath === "/profile"} onClick={onNavigate} />
    <NavLink to="/settings" active={currentPath === "/settings"} onClick={onNavigate} />
  </div>;
}

function SidebarContent({ currentPath, onNavigate }: { currentPath: string; onNavigate?: () => void }) {
  return <>
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain"><GroupedNav currentPath={currentPath} onNavigate={onNavigate} /><SearchButton /></div>
    <BottomNav currentPath={currentPath} onNavigate={onNavigate} />
    <div className="flex-none px-3 pt-3 text-[11px] text-muted-foreground">v2 · cloud sync</div>
  </>;
}

export function AppSidebar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return <aside className="fixed left-3 top-3 bottom-3 z-[100] hidden md:flex w-72 min-h-0 flex-none flex-col overflow-hidden px-3 py-5 glass-card rounded-3xl border border-white/20 bg-white/5 backdrop-blur-3xl shadow-[0_12px_40px_0_rgba(0,0,0,0.15)] isolate"><SidebarContent currentPath={path} /></aside>;
}

export function MobileTopBar() {
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const current = getNavItem(path)?.label ?? "Pace";
  return <>
    <header className="md:hidden sticky top-0 z-[120] flex items-center gap-2 mx-3 mt-[max(0.5rem,env(safe-area-inset-top))] mb-1 px-3 py-2 glass-card rounded-2xl border border-white/20 bg-white/5 backdrop-blur-3xl shadow-[0_12px_40px_0_rgba(0,0,0,0.15)]">
      <button type="button" className={`relative z-[130] size-10 ${interactiveRing}`} aria-label="Menu" aria-expanded={open} onClick={() => setOpen(true)}><Menu className="size-5" /></button>
      <div className="flex-1 font-display font-semibold text-sm truncate">{current}</div>
      <button onClick={() => window.dispatchEvent(new Event("pace.command-palette.open"))} aria-label="Rechercher" className={`size-10 ${interactiveRing}`}><Search className="size-4" /></button>
    </header>
    {open && <>
      <div className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm md:hidden" aria-hidden="true" onClick={() => setOpen(false)} />
      <aside aria-label="Navigation mobile" className="fixed inset-y-0 left-0 z-[9999] w-[280px] h-full max-w-[calc(100vw-1.5rem)] transform bg-[#050507] border-r border-white/10 p-4 shadow-2xl transition-transform duration-300 ease-in-out translate-x-0 md:hidden overflow-hidden">
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center justify-between flex-none pb-3">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">Navigation</div>
            <button type="button" onClick={() => setOpen(false)} className="size-9 grid place-items-center rounded-xl text-white/65" aria-label="Fermer le menu"><span aria-hidden="true" className="text-xl leading-none">×</span></button>
          </div>
          <SidebarContent currentPath={path} onNavigate={() => setOpen(false)} />
        </div>
      </aside>
    </>}
  </>;
}

export function MobileTabBar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { bottom, moveBottom } = useNavPrefs();
  const [dragging, setDragging] = useState<number | null>(null);
  const [pressed, setPressed] = useState<number | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => () => { if (pressTimer.current) clearTimeout(pressTimer.current); }, []);

  if (!bottom.length) return null;

  const clearPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
    startPoint.current = null;
    setPressed(null);
  };

  const beginDrag = (index: number) => {
    setDragging(index);
    setPressed(index);
    if (navigator.vibrate) navigator.vibrate(18);
  };

  const handlePointerDown = (event: React.PointerEvent, index: number) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    startPoint.current = { x: event.clientX, y: event.clientY };
    setPressed(index);
    pressTimer.current = setTimeout(() => beginDrag(index), 450);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    const start = startPoint.current;
    if (!start) return;
    const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (dragging === null && distance > 10) {
      clearPress();
      return;
    }
    if (dragging === null) return;
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-nav-slot]");
    const targetIndex = target?.dataset.navSlot ? Number(target.dataset.navSlot) : -1;
    if (targetIndex >= 0 && targetIndex < bottom.length && targetIndex !== dragging) {
      moveBottom(dragging, targetIndex);
      setDragging(targetIndex);
    }
  };

  const handlePointerUp = () => {
    const wasDragging = dragging !== null;
    if (wasDragging) suppressClick.current = true;
    setDragging(null);
    clearPress();
  };

  return <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 pointer-events-none select-none">
    <div className="glass-card pointer-events-auto mx-auto max-w-md rounded-3xl px-2 py-1.5">
      <div className="grid grid-cols-5 gap-1">
        {bottom.map((to, index) => {
          const it = getNavItem(to);
          if (!it) return null;
          const active = path === to;
          const Icon = it.icon;
          const className = `flex flex-col items-center justify-center gap-0.5 px-1.5 py-1.5 rounded-2xl text-[9px] leading-tight shrink-0 min-w-0 min-h-12 touch-none transition-[transform,opacity,background,color] duration-150 ${interactiveRing} ${dragging === index ? "scale-110 opacity-70 bg-primary/10 shadow-lg" : pressed === index ? "scale-[0.98]" : ""} ${active ? "text-primary bg-[color-mix(in_oklab,var(--primary)_14%,transparent)]" : "text-muted-foreground"}`;
          const onClick = (event: React.MouseEvent) => {
            if (suppressClick.current) {
              event.preventDefault();
              suppressClick.current = false;
            }
          };
          return <Link
            key={to}
            to={to}
            data-nav-slot={index}
            className={className}
            onClick={onClick}
            onPointerDown={(e) => handlePointerDown(e, index)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <Icon className="size-[18px] shrink-0" />
            <span className="truncate max-w-full">{it.label}</span>
          </Link>;
        })}
      </div>
      <div className="text-center text-[8px] text-muted-foreground/45 pt-0.5">Maintenir 0,5 s pour réorganiser</div>
    </div>
  </nav>;
}
