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
  "/recalls",
  "/finance",
  "/profile",
  "/settings",
];

export const BOTTOM_DEFAULT: NavItemKey[] = ["/", "/nutrition", "/sport", "/routine", "/finance"];

const ALLOWED = new Set<NavItemKey>(NAV_DEFAULT_ORDER);
const clean = (arr: unknown): NavItemKey[] =>
  Array.isArray(arr) ? (arr.filter((x): x is NavItemKey => typeof x === "string" && ALLOWED.has(x as NavItemKey))) : [];

export function useNavPrefs() {
  const [order, setOrder] = useLocalState<NavItemKey[]>("pace.mobile.nav.order", NAV_DEFAULT_ORDER);
  const [bottom, setBottom] = useLocalState<NavItemKey[]>("pace.mobile.nav.bottom", BOTTOM_DEFAULT);

  const cleanOrder = clean(order);
  const cleanBottom = clean(bottom);

  const fullOrder = [
    ...cleanOrder,
    ...NAV_DEFAULT_ORDER.filter((x) => !cleanOrder.includes(x)),
  ];

  const move = (from: number, to: number) => {
    setOrder((prev) => {
      const src = clean(prev);
      const next = [...src];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
  };

  const toggleBottom = (key: NavItemKey) => {
    setBottom((prev) => {
      const src = clean(prev);
      return src.includes(key) ? src.filter((x) => x !== key) : [...src, key];
    });
  };

  // Tous les onglets sont toujours visibles — aucun réglage ne permet plus de les masquer.
  return { order: fullOrder, setOrder, bottom: cleanBottom, toggleBottom, move };
}
