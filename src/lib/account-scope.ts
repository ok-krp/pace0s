const ACCOUNT_SCOPE_KEY = "pace.__account_scope";
const DEVICE_KEY = "pace.__sync_device_id";
const PRESERVED_KEYS = new Set([ACCOUNT_SCOPE_KEY, DEVICE_KEY]);

/**
 * Keep the signed-in user's local cache across a normal sign-out/sign-in cycle.
 * When a different account signs in, discard the previous user's app state so
 * it cannot leak into the new account while cloud hydration is running.
 */
export function switchLocalAccountScope(userId: string | null) {
  if (typeof window === "undefined" || !userId) return false;
  const nextScope = userId;
  try {
    const previousScope = localStorage.getItem(ACCOUNT_SCOPE_KEY);
    if (previousScope === nextScope) return false;

    for (const key of Object.keys(localStorage)) {
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
