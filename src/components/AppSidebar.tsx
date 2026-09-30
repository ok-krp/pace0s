import { Link, useRouterState } from "@tanstack/react-router";
import { memo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { LayoutDashboard, Moon, Apple, Scale, Briefcase, Calendar, Wallet, Settings, Sparkles, User as UserIcon, Menu, Dumbbell, AlertTriangle, ChevronDown, Wrench, History, Search, Watch, ShoppingCart } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
/* Legacy Radix Sheet imports kept commented for rollback/reference:
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
*/
import { useNavPrefs, type NavItemKey } from "@/hooks/use-nav-prefs";
import { useLocalState } from "@/lib/storage";
import { springSoft, interactiveRing } from "@/lib/motion";
const NativeNavLink = ({ to, className, children, onClick, draggable, onDragStart }: { to: NavItemKey; className?: string; children: React.ReactNode; onClick?: () => void; draggable?: boolean; onDragStart?: React.DragEventHandler<HTMLAnchorElement> }) => <Link to={to} onClick={onClick} onDragStart={onDragStart} draggable={draggable} className={className}>{children}</Link>;
export const NAV_REGISTRY: Record<NavItemKey, { label: string; icon: typeof LayoutDashboard }> = { "/": { label: "Accueil", icon: LayoutDashboard }, "/assistant": { label: "Assistant IA", icon: Sparkles }, "/development": { label: "Développement", icon: Wrench }, "/ai-activity": { label: "Actions IA", icon: History }, "/nutrition": { label: "Nutrition", icon: Apple }, "/courses": { label: "Courses", icon: ShoppingCart }, "/sport": { label: "Sport", icon: Dumbbell }, "/watch": { label: "Montre", icon: Watch }, "/sleep": { label: "Sommeil", icon: Moon }, "/routine": { label: "Routine", icon: Moon }, "/body": { label: "Poids & Corps", icon: Scale }, "/work": { label: "Travail", icon: Briefcase }, "/calendar": { label: "Calendrier", icon: Calendar }, "/recalls": { label: "Rappels conso", icon: AlertTriangle }, "/finance": { label: "Finance & Invest.", icon: Wallet }, "/profile": { label: "Profil", icon: UserIcon }, "/settings": { label: "Paramètres", icon: Settings } };
type Group = { id: string; label: string; items: NavItemKey[] };
const GROUPS: Group[] = [{ id: "assistant", label: "Intelligence Artificielle", items: ["/assistant", "/development", "/ai-activity"] }, { id: "nutrition", label: "Nutrition", items: ["/nutrition", "/courses"] }, { id: "activite", label: "Activité", items: ["/body", "/sport", "/watch", "/sleep", "/calendar", "/work"] }, { id: "finance", label: "Finance", items: ["/finance"] }];
const getNavItem = (key: string) => NAV_REGISTRY[key as NavItemKey];
const NavLink = memo(function NavLink({ to, active, onClick, draggable = false, dragging = false }: { to: NavItemKey; active: boolean; onClick?: () => void; draggable?: boolean; dragging?: boolean }) { const it = getNavItem(to); if (!it) return null; const Icon = it.icon; const className = `group flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-[background,box-shadow,color,transform,opacity] duration-200 ${interactiveRing} ${dragging ? "scale-[1.04] opacity-70 z-10 shadow-lg bg-primary/10 cursor-grabbing" : ""} ${active ? "text-foreground font-medium bg-[rgb(var(--glass-tint)/calc(var(--glass-tint-strength)+0.16))] shadow-[inset_0_1px_0_0_color-mix(in_oklab,white_calc(var(--glass-edge)*55%),transparent),0_0_0_1px_color-mix(in_oklab,var(--primary)_14%,transparent),0_6px_18px_-12px_color-mix(in_oklab,var(--primary)_50%,transparent)]" : "text-muted-foreground hover:bg-[rgb(var(--glass-tint)/calc(var(--glass-tint-strength)*0.5))]"} ${draggable ? "touch-none select-none" : ""}`; return <NativeNavLink to={to} onClick={onClick} className={className} draggable={false} onDragStart={(e) => e.preventDefault()}><Icon className={`size-4 shrink-0 ${active ? "text-primary" : ""}`} /><span>{it.label}</span></NativeNavLink>; });

function GroupedNav({ currentPath, onNavigate }: { currentPath: string; onNavigate?: () => void }) {
  const [openMap, setOpenMap] = useLocalState<Record<string, boolean>>("pace.sidebar.groups", { assistant: true, nutrition: true, activite: true, finance: true });
  const [orderMap, setOrderMap] = useLocalState<Record<string, NavItemKey[]>>("pace.sidebar.submenu-order", {});
  const [recallCount] = useLocalState<number>("pace.recalls.count", 0);
  const { visibleOrder } = useNavPrefs();
  const visibleSet = new Set(visibleOrder);
  const [dragging, setDragging] = useState<{ groupId: string; key: NavItemKey } | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const suppressClick = useRef(false);

  const orderedItems = (group: Group) => {
    const visible = group.items.filter((to) => visibleSet.has(to));
    const saved = orderMap[group.id] ?? [];
    return [...saved.filter((to) => visible.includes(to)), ...visible.filter((to) => !saved.includes(to))];
  };

  const clearTimer = (key: string) => {
    if (timers.current[key]) clearTimeout(timers.current[key]);
    delete timers.current[key];
  };

  const startLongPress = (groupId: string, key: NavItemKey, e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    clearTimer(groupId + ":" + key);
    timers.current[groupId + ":" + key] = setTimeout(() => {
      setDragging({ groupId, key });
      suppressClick.current = true;
      if (navigator.vibrate) navigator.vibrate(18);
    }, 500);
  };

  const handleMove = (groupId: string, key: NavItemKey, e: React.PointerEvent) => {
    if (!dragging || dragging.groupId !== groupId || dragging.key !== key) return;
    e.preventDefault();
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-sidebar-item]");
    const targetGroup = target?.dataset.sidebarGroup;
    const targetKey = target?.dataset.sidebarItem as NavItemKey | undefined;
    if (!targetGroup || targetGroup !== groupId || !targetKey || targetKey === key) return;
    setOrderMap((previous) => {
      const current = orderedItems(GROUPS.find((g) => g.id === groupId)!);
      const from = current.indexOf(key);
      const to = current.indexOf(targetKey);
      if (from < 0 || to < 0 || from === to) return previous;
      const next = [...current];
      next.splice(from, 1);
      next.splice(to, 0, key);
      return { ...previous, [groupId]: next };
    });
  };

  const endPointer = (groupId: string, key: NavItemKey, e?: React.PointerEvent) => {
    clearTimer(groupId + ":" + key);
    if (e && e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (dragging?.groupId === groupId && dragging.key === key) setDragging(null);
  };

  return <nav className="flex flex-col gap-0.5">
    <NavLink to="/" active={currentPath === "/"} onClick={onNavigate} />
    {GROUPS.map((g) => {
      const items = orderedItems(g);
      if (!items.length) return null;
      const hasActive = items.includes(currentPath as NavItemKey);
      const open = openMap[g.id] ?? hasActive;
      return <Collapsible key={g.id} open={open} onOpenChange={(v) => setOpenMap((p) => ({ ...p, [g.id]: v }))} className="mt-3 pt-3 border-t border-[color-mix(in_oklab,white_calc(var(--glass-edge)*30%),transparent)]">
        <CollapsibleTrigger className={`w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground rounded-md transition-colors duration-300 ${interactiveRing}`}>
          <span>{g.label}</span><motion.span animate={{ rotate: open ? 180 : 0 }} transition={springSoft} className="inline-flex"><ChevronDown className="size-3" /></motion.span>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-0.5 mt-0.5">
          {items.map((to) => <div key={to} data-sidebar-item={to} data-sidebar-group={g.id} onPointerDown={(e) => startLongPress(g.id, to, e)} onPointerMove={(e) => handleMove(g.id, to, e)} onPointerUp={(e) => endPointer(g.id, to, e)} onPointerCancel={(e) => endPointer(g.id, to, e)} onDragStart={(e) => e.preventDefault()}>
            <NavLink to={to} active={currentPath === to} onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onNavigate?.(); }} draggable dragging={dragging?.groupId === g.id && dragging.key === to} />
          </div>)}
        </CollapsibleContent>
      </Collapsible>;
    })}
    {dragging && <div className="px-3 pt-1 text-[10px] text-muted-foreground">Maintenir 0,5 s, puis glisser pour réorganiser</div>}
  </nav>;
}

function BottomNav({ currentPath, onNavigate }: { currentPath: string; onNavigate?: () => void }) { return <div className="mt-auto pt-4 border-t border-[color-mix(in_oklab,white_calc(var(--glass-edge)*30%),transparent)] space-y-0.5"><NavLink to="/profile" active={currentPath === "/profile"} onClick={onNavigate} /><NavLink to="/settings" active={currentPath === "/settings"} onClick={onNavigate} /></div>; }
function SidebarContent({ currentPath, onNavigate }: { currentPath: string; onNavigate?: () => void }) {
  return <>
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("pace.command-palette.open"))}
      className="flex-none w-full flex items-center gap-2 px-3 py-2 mb-2 rounded-xl glass-thin border border-white/20 bg-white/10 backdrop-blur-2xl text-sm text-foreground transition"
    >
      <Search className="size-3.5 shrink-0" />
      <span className="flex-1 text-left">Rechercher…</span>
      <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-muted font-mono">⌘K</kbd>
    </button>
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
      <GroupedNav currentPath={currentPath} onNavigate={onNavigate} />
    </div>
    <BottomNav currentPath={currentPath} onNavigate={onNavigate} />
    <div className="flex-none px-3 pt-3 text-[11px] text-muted-foreground">v2 · cloud sync</div>
  </>;
}

export function AppSidebar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return <aside className="fixed left-3 top-3 bottom-3 z-[100] hidden md:flex w-72 min-h-0 flex-none flex-col overflow-hidden px-3 py-5 glass-card rounded-3xl border border-white/20 bg-white/5 backdrop-blur-3xl shadow-[0_12px_40px_0_rgba(0,0,0,0.15)] isolate">
    <SidebarContent currentPath={path} />
  </aside>;
}

export function MobileTopBar() {
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const current = getNavItem(path)?.label ?? "Pace";

  return <>
    <header className="md:hidden sticky top-0 z-[120] flex items-center gap-2 mx-3 mt-[max(0.5rem,env(safe-area-inset-top))] mb-1 px-3 py-2 glass-card rounded-2xl border border-white/20 bg-white/5 backdrop-blur-3xl shadow-[0_12px_40px_0_rgba(0,0,0,0.15)]">
      <button
        type="button"
        className={`relative z-[130] size-10 ${interactiveRing}`}
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Menu className="size-5" />
      </button>
      <div className="flex-1 font-display font-semibold text-sm truncate">{current}</div>
      <button onClick={() => window.dispatchEvent(new Event("pace.command-palette.open"))} aria-label="Rechercher" className={`size-10 ${interactiveRing}`}>
        <Search className="size-4" />
      </button>
    </header>

    {open && <>
      <div
        className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm md:hidden"
        aria-hidden="true"
        onClick={() => setOpen(false)}
      />
      <aside
        aria-label="Navigation mobile"
        className="fixed inset-y-0 left-0 z-[9999] w-[280px] h-full max-w-[calc(100vw-1.5rem)] transform bg-[#050507] border-r border-white/10 p-4 shadow-2xl transition-transform duration-300 ease-in-out translate-x-0 md:hidden overflow-hidden"
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center justify-between flex-none pb-3">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">Navigation</div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="size-9 grid place-items-center rounded-md text-white/65"
              aria-label="Fermer le menu"
            >
              <span aria-hidden="true" className="text-xl leading-none">×</span>
            </button>
          </div>
          <SidebarContent currentPath={path} onNavigate={() => setOpen(false)} />
        </div>
      </aside>
    </>}

    {/*
      Legacy Radix Sheet implementation kept intact for rollback/reference.
      The direct drawer above intentionally replaces the portal/overlay path:
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>...</SheetTrigger>
        <SheetContent side="left" ...>
          <SheetTitle className="sr-only">Menu de navigation</SheetTitle>
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <SidebarContent currentPath={path} onNavigate={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    */}
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
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    startPoint.current = { x: event.clientX, y: event.clientY };
    setPressed(index);
    pressTimer.current = setTimeout(() => beginDrag(index), 2000);
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

  const handlePointerUp = (event?: React.PointerEvent) => {
    if (dragging !== null) suppressClick.current = true;
    if (event?.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(null);
    clearPress();
  };

  if (!bottom.length) return null;

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 pointer-events-none select-none">
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
            return (
              <Link
                key={to}
                to={to}
                data-nav-slot={index}
                className={className}
                onClick={onClick}
                onContextMenu={(e) => e.preventDefault()}
                onPointerDown={(e) => handlePointerDown(e, index)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              >
                <Icon className="size-[18px] shrink-0" />
                <span className="truncate max-w-full">{it.label}</span>
              </Link>
            );
          })}
        </div>
        <div className="text-center text-[8px] text-muted-foreground/45 pt-0.5">Maintenir 2 s pour réorganiser</div>
      </div>
    </nav>
  );
}
