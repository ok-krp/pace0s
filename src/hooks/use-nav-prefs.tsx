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
  const [order, setOrder] = useLocalState<NavItemKey[]>("lt.mobile.nav.order", NAV_DEFAULT_ORDER);
  const [bottom, setBottom] = useLocalState<NavItemKey[]>("lt.mobile.nav.bottom", BOTTOM_DEFAULT);
  const [visible, setVisible] = useLocalState<NavItemKey[]>("lt.mobile.nav.visible", NAV_DEFAULT_ORDER);

  const cleanOrder = clean(order);
  const cleanBottom = clean(bottom);
  const cleanVisible = clean(visible);

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

  const toggleVisible = (key: NavItemKey) => {
    setVisible((prev) => {
      const src = clean(prev);
      return src.includes(key) ? src.filter((x) => x !== key) : [...src, key];
    });
  };

  const visibleSet = new Set(cleanVisible.length ? cleanVisible : NAV_DEFAULT_ORDER);
  const visibleOrder = fullOrder.filter((k) => visibleSet.has(k));

  return { order: fullOrder, visibleOrder, setOrder, bottom: cleanBottom, toggleBottom, move, visible: cleanVisible, toggleVisible };
}
