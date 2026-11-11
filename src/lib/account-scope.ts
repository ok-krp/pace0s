const ACCOUNT_SCOPE_KEY = "pace.__account_scope";
const ACCOUNT_DATA_PREFIX = "pace.__account_data:";

/**
 * App-owned browser state that must follow the authenticated user across
 * sign-out/sign-in cycles. Internal keys (pace.__*) stay in place: in
 * particular, account-scoped sync queues and the device ID are not moved.
 */
function isAccountLocalKey(key: string): boolean {
  return (key.startsWith("pace.") && !key.startsWith("pace.__")) ||
    key.startsWith("lt.");
}

function accountSnapshotKey(scope: string): string {
  return ACCOUNT_DATA_PREFIX + encodeURIComponent(scope);
}

function captureCurrentAccountState(): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const key of Object.keys(localStorage)) {
    if (!isAccountLocalKey(key)) continue;
    const value = localStorage.getItem(key);
    if (value !== null) snapshot[key] = value;
  }
  return snapshot;
}

function readAccountSnapshot(scope: string): Record<string, string> {
  const raw = localStorage.getItem(accountSnapshotKey(scope));
  if (raw === null) return {};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Snapshot local de compte invalide.");
  }
  const snapshot: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isAccountLocalKey(key) && typeof entry === "string") {
      snapshot[key] = entry;
    }
  }
  return snapshot;
}

function restoreAccountSnapshot(snapshot: Record<string, string>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (isAccountLocalKey(key)) localStorage.setItem(key, value);
  }
}

function clearCurrentAccountState(): void {
  for (const key of Object.keys(localStorage)) {
    if (isAccountLocalKey(key)) localStorage.removeItem(key);
  }
}

/**
 * Switch the shared app-facing localStorage view while preserving a private
 * snapshot for every account. The first authenticated account adopts legacy
 * unscoped local data instead of losing it. Later account switches save the
 * previous account before restoring the next one.
 *
 * Passing null moves the signed-out view to a separate guest snapshot.
 */
export function switchLocalAccountScope(userId: string | null): boolean {
  if (typeof window === "undefined") return false;
  const nextScope = userId ?? "__guest__";

  try {
    const previousScope = localStorage.getItem(ACCOUNT_SCOPE_KEY);
    if (previousScope === nextScope) return false;

    const currentSnapshot = captureCurrentAccountState();

    // Preserve the first install's legacy state for the first authenticated
    // account. A signed-out initial render leaves it untouched as guest data.
    if (previousScope === null) {
      if (!userId) return false;
      localStorage.setItem(
        accountSnapshotKey(nextScope),
        JSON.stringify(currentSnapshot),
      );
      localStorage.setItem(ACCOUNT_SCOPE_KEY, nextScope);
      window.dispatchEvent(new Event("pace.account.scope.changed"));
      window.dispatchEvent(new Event("pace.remote.write"));
      return true;
    }

    // Parse the target snapshot before mutating the current visible data.
    const nextSnapshot = readAccountSnapshot(nextScope);

    // Save the previous account first. If this fails, leave the current view
    // untouched so an account switch cannot silently discard manual entries.
    localStorage.setItem(
      accountSnapshotKey(previousScope),
      JSON.stringify(currentSnapshot),
    );

    try {
      clearCurrentAccountState();
      restoreAccountSnapshot(nextSnapshot);
      localStorage.setItem(ACCOUNT_SCOPE_KEY, nextScope);
    } catch (error) {
      // Best-effort rollback to the previous account's visible state.
      clearCurrentAccountState();
      restoreAccountSnapshot(currentSnapshot);
      localStorage.setItem(ACCOUNT_SCOPE_KEY, previousScope);
      throw error;
    }

    // AuthProvider remounts the user subtree after this function returns.
    // These events also let any long-lived domain readers rehydrate promptly.
    window.dispatchEvent(new Event("pace.account.scope.changed"));
    window.dispatchEvent(new Event("pace.remote.write"));
    return true;
  } catch (error) {
    console.error("[account-scope] local account switch failed", error);
    throw new Error("Impossible de préserver les données locales avant le changement de compte.");
  }
}
