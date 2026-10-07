import { useLocalState } from "@/lib/storage";

export type NavItemKey =
  | "/" | "/assistant" | "/development" | "/ai-activity" | "/nutrition" | "/courses" | "/sport" | "/watch"
  | "/sleep" | "/routine" | "/body" | "/work" | "/calendar" | "/recalls" | "/finance" | "/profile" | "/settings";
export const NAV_DEFAULT_ORDER: NavItemKey[] = ["/", "/assistant", "/development", "/ai-activity", "/nutrition", "/courses", "/sport", "/watch", "/sleep", "/routine", "/body", "/work", "/calendar", "/recalls", "/finance", "/profile", "/settings"];
export const BOTTOM_DEFAULT: NavItemKey[] = ["/", "/nutrition", "/courses", "/sport", "/work"];
const ALLOWED = new Set<NavItemKey>(NAV_DEFAULT_ORDER);
const clean = (arr: unknown): NavItemKey[] => Array.isArray(arr) ? arr.filter((x): x is NavItemKey => typeof x === "string" && ALLOWED.has(x as NavItemKey)) : [];

const normalizeBottom = (arr: unknown): NavItemKey[] => {
  const src = clean(arr).filter((x) => x !== "/");
  const withHome = ["/" as NavItemKey, ...src];
  return [...withHome, ...BOTTOM_DEFAULT.filter((x) => !withHome.includes(x))].slice(0, 5);
};

export function useNavPrefs() {
  const [order, setOrder] = useLocalState<NavItemKey[]>("pace.mobile.nav.order", NAV_DEFAULT_ORDER);
  const [bottom, setBottom] = useLocalState<NavItemKey[]>("pace.mobile.nav.bottom", BOTTOM_DEFAULT);
  const [visible, setVisible] = useLocalState<NavItemKey[]>("pace.mobile.nav.visible", NAV_DEFAULT_ORDER);
  const cleanOrder = clean(order);
  const cleanVisible = clean(visible);
  const fullOrder = [...cleanOrder, ...NAV_DEFAULT_ORDER.filter((x) => !cleanOrder.includes(x))];
  const repairedBottom = normalizeBottom(bottom);

  const move = (from: number, to: number) => setOrder((prev) => {
    const src = clean(prev);
    const next = [...src];
    const [item] = next.splice(from, 1);
    if (item !== undefined) next.splice(to, 0, item);
    return next;
  });

  const moveBottom = (from: number, to: number) => setBottom((prev) => {
    const src = normalizeBottom(prev);
    const next = [...src];
    const [item] = next.splice(from, 1);
    if (item !== undefined) next.splice(to, 0, item);
    return next;
  });

  const toggleBottom = (key: NavItemKey) => setBottom((prev) => {
    const src = normalizeBottom(prev);
    if (key === "/") return src;
    return src.includes(key) ? src.filter((x) => x !== key) : [...src, key].slice(-5);
  });

  const toggleVisible = (key: NavItemKey) => setVisible((prev) => {
    const src = clean(prev);
    if (src.includes(key) && src.length <= 1) return src;
    return src.includes(key) ? src.filter((x) => x !== key) : [...src, key];
  });

  const visibleSet = new Set(cleanVisible.length ? cleanVisible : NAV_DEFAULT_ORDER);
  const visibleOrder = fullOrder.filter((k) => k === "/" || k === "/settings" || visibleSet.has(k));

  return {
    order: fullOrder,
    visibleOrder,
    setOrder,
    bottom: repairedBottom,
    toggleBottom,
    moveBottom,
    move,
    visible: cleanVisible,
    toggleVisible,
  };
}
