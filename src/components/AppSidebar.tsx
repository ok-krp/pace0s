import { Link, useRouterState } from "@tanstack/react-router";
import { memo, useState } from "react";
import { motion } from "framer-motion";
import { LayoutDashboard, Moon, Apple, Scale, Briefcase, Calendar, Wallet, Settings, Sparkles, User as UserIcon, Menu, Dumbbell, AlertTriangle, ChevronDown, Wrench, History, Search, Watch, ShoppingCart } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useNavPrefs, type NavItemKey } from "@/hooks/use-nav-prefs";
import { useLocalState } from "@/lib/storage";
import { springSoft, interactiveRing } from "@/lib/motion";
const NativeNavLink = ({ to, className, children, onClick }: { to: NavItemKey; className?: string; children: React.ReactNode; onClick?: () => void }) => <Link to={to} onClick={onClick} className={className}>{children}</Link>;
export const NAV_REGISTRY: Record<NavItemKey, { label: string; icon: typeof LayoutDashboard }> = { "/": { label: "Dashboard", icon: LayoutDashboard }, "/assistant": { label: "Assistant IA", icon: Sparkles }, "/development": { label: "Développement", icon: Wrench }, "/ai-activity": { label: "Actions IA", icon: History }, "/nutrition": { label: "Nutrition", icon: Apple }, "/courses": { label: "Courses", icon: ShoppingCart }, "/sport": { label: "Sport", icon: Dumbbell }, "/watch": { label: "Montre", icon: Watch }, "/sleep": { label: "Sommeil", icon: Moon }, "/routine": { label: "Routine", icon: Moon }, "/body": { label: "Poids & Corps", icon: Scale }, "/work": { label: "Travail", icon: Briefcase }, "/calendar": { label: "Calendrier", icon: Calendar }, "/recalls": { label: "Rappels conso", icon: AlertTriangle }, "/finance": { label: "Finance & Invest.", icon: Wallet }, "/profile": { label: "Profil", icon: UserIcon }, "/settings": { label: "Paramètres", icon: Settings } };
type Group = { id: string; label: string; items: NavItemKey[] };
const GROUPS: Group[] = [{ id: "assistant", label: "Intelligence Artificielle", items: ["/assistant", "/development", "/ai-activity"] }, { id: "nutrition", label: "Nutrition", items: ["/nutrition", "/courses"] }, { id: "activite", label: "Activité", items: ["/body", "/sport", "/watch", "/sleep", "/calendar", "/work"] }, { id: "finance", label: "Finance", items: ["/finance"] }];
const getNavItem = (key: string) => NAV_REGISTRY[key as NavItemKey];
const NavLink = memo(function NavLink({ to, active, onClick }: { to: NavItemKey; active: boolean; onClick?: () => void }) { const it = getNavItem(to); if (!it) return null; const Icon = it.icon; const className = `group flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-[background,box-shadow,color] duration-300 ${interactiveRing} ${active ? "text-foreground font-medium bg-[rgb(var(--glass-tint)/calc(var(--glass-tint-strength)+0.16))] shadow-[inset_0_1px_0_0_color-mix(in_oklab,white_calc(var(--glass-edge)*55%),transparent),0_0_0_1px_color-mix(in_oklab,var(--primary)_14%,transparent),0_6px_18px_-12px_color-mix(in_oklab,var(--primary)_50%,transparent)]" : "text-muted-foreground hover:text-foreground hover:bg-[rgb(var(--glass-tint)/calc(var(--glass-tint-strength)*0.5))]" }`; return <NativeNavLink to={to} onClick={onClick} className={className}><Icon className={`size-4 shrink-0 ${active ? "text-primary" : ""}`} /><span>{it.label}</span></NativeNavLink>; });
function GroupedNav({ currentPath, onNavigate }: { currentPath: string; onNavigate?: () => void }) { const [openMap, setOpenMap] = useLocalState<Record<string, boolean>>("pace.sidebar.groups", { assistant: true, nutrition: true, activite: true, finance: true }); const [recallCount] = useLocalState<number>("pace.recalls.count", 0); const { visibleOrder } = useNavPrefs(); const visibleSet = new Set(visibleOrder); return <nav className="flex flex-col gap-0.5"><NavLink to="/" active={currentPath === "/"} onClick={onNavigate} />{GROUPS.map((g) => { const items = g.items.filter((to) => visibleSet.has(to)); if (!items.length) return null; const hasActive = items.includes(currentPath as NavItemKey); const open = openMap[g.id] ?? hasActive; return <Collapsible key={g.id} open={open} onOpenChange={(v) => setOpenMap((p) => ({ ...p, [g.id]: v }))} className="mt-3 pt-3 border-t border-[color-mix(in_oklab,white_calc(var(--glass-edge)*30%),transparent)]"><CollapsibleTrigger className={`w-full flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground rounded-md transition-colors duration-300 ${interactiveRing}`}><span>{g.label}</span><motion.span animate={{ rotate: open ? 180 : 0 }} transition={springSoft} className="inline-flex"><ChevronDown className="size-3" /></motion.span></CollapsibleTrigger><CollapsibleContent className="flex flex-col gap-0.5 mt-0.5">{items.map((to) => <NavLink key={to} to={to} active={currentPath === to} onClick={onNavigate} />)}</CollapsibleContent></Collapsible>; })}</nav>; }
function BottomNav({ currentPath, onNavigate }: { currentPath: string; onNavigate?: () => void }) { return <div className="mt-auto pt-4 border-t border-[color-mix(in_oklab,white_calc(var(--glass-edge)*30%),transparent)] space-y-0.5"><NavLink to="/profile" active={currentPath === "/profile"} onClick={onNavigate} /><NavLink to="/settings" active={currentPath === "/settings"} onClick={onNavigate} /></div>; }
function SidebarContent({ currentPath, onNavigate }: { currentPath: string; onNavigate?: () => void }) {
  return <>
    <div className="flex-none flex items-center gap-2 px-3 py-2 mb-4">
      <Link to="/" search={{}} onClick={onNavigate} className="flex items-center gap-2">
        <div className="size-8 grid place-items-center text-primary"><Sparkles className="size-4" /></div>
        <div>
          <div className="font-display font-semibold text-[15px] tracking-tight">Pace</div>
          <div className="text-[11px] text-muted-foreground -mt-0.5">centre de contrôle</div>
        </div>
      </Link>
    </div>
    <button onClick={() => window.dispatchEvent(new Event("pace.command-palette.open"))} className="flex-none flex items-center gap-2 px-3 py-2 mb-3 rounded-md glass-thin text-sm text-muted-foreground hover:text-foreground transition">
      <Search className="size-3.5" /><span className="flex-1 text-left">Rechercher…</span><kbd className="text-[10px] px-1.5 py-0.5 rounded bg-muted font-mono">⌘K</kbd>
    </button>
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain"><GroupedNav currentPath={currentPath} onNavigate={onNavigate} /></div>
    <BottomNav currentPath={currentPath} onNavigate={onNavigate} />
    <div className="flex-none px-3 pt-3 text-[11px] text-muted-foreground">v2 · cloud sync</div>
  </>;
}

export function AppSidebar() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return <aside className="fixed left-3 top-3 bottom-3 z-[100] hidden md:flex w-72 min-h-0 flex-none flex-col overflow-hidden px-3 py-5 glass-card rounded-[20px] isolate">
    <SidebarContent currentPath={path} />
  </aside>;
}

export function MobileTopBar() {
  const [open, setOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const current = getNavItem(path)?.label ?? "Pace";

  return <header className="md:hidden sticky top-0 z-[120] flex items-center gap-2 mx-3 mt-[max(0.5rem,env(safe-area-inset-top))] mb-1 px-3 py-2 glass-card rounded-[18px]">
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button type="button" className={`relative z-[130] size-10 ${interactiveRing}`} aria-label="Menu" aria-expanded={open}>
          <Menu className="size-5" />
        </button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[min(88vw,20rem)] max-w-[calc(100vw-1.5rem)] min-h-0 p-3 pt-5 rounded-r-[20px] md:hidden">
        <SheetTitle className="sr-only">Menu de navigation</SheetTitle>
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <SidebarContent currentPath={path} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
    <div className="flex-1 font-display font-semibold truncate">{current}</div>
    <button onClick={() => window.dispatchEvent(new Event("pace.command-palette.open"))} aria-label="Rechercher" className={`size-10 ${interactiveRing}`}>
      <Search className="size-4" />
    </button>
  </header>;
}
