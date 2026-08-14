import { useLocalState } from "@/lib/storage";

export type NavItemKey =
  | "/"
  | "/assistant"
  | "/development"
  | "/ai-activity"
  | "/nutrition"
  | "/sport"
  | "/sleep"
  | "/routine"
  | "/body"
  | "/work"
  | "/calendar"
  | "/notes"
  | "/recalls"
  | "/finance"
  | "/profile"
  | "/settings";

export const NAV_DEFAULT_ORDER: NavItemKey[] = [
  "/",
  "/assistant",
  "/development",
  "/ai-activity",
  "/nutrition",
  "/sport",
  "/sleep",
  "/routine",
  "/body",
  "/work",
  "/calendar",
  "/notes",
  "/recalls",
  "/finance",
  "/profile",
  "/settings",
];

export const BOTTOM_DEFAULT: NavItemKey[] = ["/", "/nutrition", "/sport", "/routine", "/finance"];

/**
 * La navigation PaceOS est désormais fixe : tous les onglets sont disponibles
 * par défaut et l'utilisateur ne peut plus les masquer, les ajouter ou les retirer.
 * Les anciennes préférences sont volontairement ignorées pour éviter qu'une
 * ancienne configuration ne fasse disparaître des onglets après la mise à jour.
 */
export function useNavPrefs() {
  // Conserve les anciennes clés uniquement pour compatibilité de stockage ; elles
  // ne contrôlent plus l'interface. Cela évite une migration destructive inutile.
  useLocalState<NavItemKey[]>("pace.mobile.nav.order", NAV_DEFAULT_ORDER);
  useLocalState<NavItemKey[]>("pace.mobile.nav.bottom", BOTTOM_DEFAULT);
  useLocalState<NavItemKey[]>("pace.mobile.nav.visible", NAV_DEFAULT_ORDER);

  return {
    order: NAV_DEFAULT_ORDER,
    visibleOrder: NAV_DEFAULT_ORDER,
    bottom: BOTTOM_DEFAULT,
    visible: NAV_DEFAULT_ORDER,
    // API de compatibilité : les anciens appels ne cassent pas, mais aucune
    // préférence utilisateur ne peut modifier la navigation.
    setOrder: () => undefined,
    toggleBottom: () => undefined,
    move: () => undefined,
    toggleVisible: () => undefined,
  };
}
