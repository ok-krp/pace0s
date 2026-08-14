import { NAV_DEFAULT_ORDER } from "@/hooks/use-nav-prefs";
import { NAV_REGISTRY } from "@/components/AppSidebar";

/**
 * La navigation est volontairement fixe dans PaceOS.
 * Tous les onglets sont disponibles par défaut et aucune préférence ne permet
 * désormais de les masquer, retirer ou ajouter.
 */
export function MobileNavSettings() {
  return (
    <div className="rounded-2xl glass-card p-5">
      <div className="font-display text-lg font-semibold mb-1">Navigation mobile</div>
      <div className="text-xs text-muted-foreground mb-4">
        Tous les onglets PaceOS sont disponibles par défaut et cette navigation ne peut pas être personnalisée.
      </div>

      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        Onglets disponibles ({NAV_DEFAULT_ORDER.length})
      </div>
      <div className="grid grid-cols-2 gap-2">
        {NAV_DEFAULT_ORDER.map((key) => {
          const it = NAV_REGISTRY[key];
          const Icon = it.icon;
          return (
            <div
              key={key}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm opacity-80"
            >
              <Icon className="size-4 text-muted-foreground" />
              <span className="truncate">{it.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
