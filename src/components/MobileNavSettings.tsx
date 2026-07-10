import { useNavPrefs, NAV_DEFAULT_ORDER, type NavItemKey } from "@/hooks/use-nav-prefs";
import { NAV_REGISTRY } from "@/components/AppSidebar";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ArrowUp, ArrowDown } from "lucide-react";

export function MobileNavSettings() {
  const { order, bottom, toggleBottom, move, setOrder, visible, toggleVisible } = useNavPrefs();

  return (
    <div className="rounded-2xl bg-card border border-border p-5 shadow-[var(--shadow-soft)]">
      <div className="font-display text-lg font-semibold mb-1">Navigation mobile</div>
      <div className="text-xs text-muted-foreground mb-4">
        Choisissez les sections visibles dans le volet, vos raccourcis du bas (scrollables) et l'ordre.
      </div>

      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        Sections visibles dans le volet ({visible.length}/{NAV_DEFAULT_ORDER.length})
      </div>
      <div className="grid grid-cols-2 gap-2 mb-5">
        {NAV_DEFAULT_ORDER.map((key) => {
          const it = NAV_REGISTRY[key];
          const checked = visible.includes(key);
          const Icon = it.icon;
          return (
            <label
              key={key}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/50 cursor-pointer"
            >
              <Checkbox checked={checked} onCheckedChange={() => toggleVisible(key)} />
              <Icon className="size-4 text-muted-foreground" />
              <span className="truncate">{it.label}</span>
            </label>
          );
        })}
      </div>

      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        Raccourcis en bas ({bottom.length}) — scrollables horizontalement
      </div>
      <div className="grid grid-cols-2 gap-2 mb-5">
        {NAV_DEFAULT_ORDER.map((key) => {
          const it = NAV_REGISTRY[key];
          const checked = bottom.includes(key);
          const Icon = it.icon;
          return (
            <label
              key={key}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/50 cursor-pointer"
            >
              <Checkbox checked={checked} onCheckedChange={() => toggleBottom(key)} />
              <Icon className="size-4 text-muted-foreground" />
              <span className="truncate">{it.label}</span>
            </label>
          );
        })}
      </div>

      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        Ordre du volet
      </div>
      <ul className="space-y-1">
        {order.map((key, i) => {
          const it = NAV_REGISTRY[key];
          const Icon = it.icon;
          return (
            <li key={key} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <Icon className="size-4 text-muted-foreground" />
              <span className="flex-1 truncate">{it.label}</span>
              <Button variant="ghost" size="icon" className="size-7" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label="Monter">
                <ArrowUp className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" className="size-7" disabled={i === order.length - 1} onClick={() => move(i, i + 1)} aria-label="Descendre">
                <ArrowDown className="size-4" />
              </Button>
            </li>
          );
        })}
      </ul>
      <button
        onClick={() => setOrder(NAV_DEFAULT_ORDER as NavItemKey[])}
        className="text-xs text-muted-foreground hover:text-foreground underline mt-3"
      >
        Réinitialiser l'ordre
      </button>
    </div>
  );
}
