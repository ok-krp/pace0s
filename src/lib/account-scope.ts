const ACCOUNT_SCOPE_KEY = "pace.__account_scope";
const DEVICE_KEY = "pace.__sync_device_id";
const PRESERVED_KEYS = new Set([ACCOUNT_SCOPE_KEY, DEVICE_KEY]);

/**
 * Local Pace state is user-owned. Never let the previous authenticated account
 * seed the next account's local state or cloud-sync queue.
 */
export function switchLocalAccountScope(userId: string | null) {
  if (typeof window === "undefined") return false;
  const nextScope = userId ?? "anonymous";
  try {
    const previousScope = localStorage.getItem(ACCOUNT_SCOPE_KEY);
    if (previousScope === nextScope) return false;

    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if ((key.startsWith("pace.") || key.startsWith("lt.")) && !PRESERVED_KEYS.has(key)) {
        localStorage.removeItem(key);
      }
    }
    localStorage.setItem(ACCOUNT_SCOPE_KEY, nextScope);
    return true;
  } catch {
    return false;
  }
}
