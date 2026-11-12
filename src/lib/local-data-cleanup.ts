export interface LocalStorageLike {
  readonly length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
}

export type LocalPaceCleanupResult = {
  deviceCacheCleared: boolean;
  localStorageCleared: boolean;
  errors: string[];
};

/**
 * Clears current and legacy Pace-owned browser state without allowing an IndexedDB
 * failure to block the localStorage purge. This is used by per-device reset and
 * account deletion; unrelated application storage keys are never touched.
 */
export async function clearLocalPaceData(
  storage: LocalStorageLike | null,
  clearDeviceCache: () => Promise<void>,
): Promise<LocalPaceCleanupResult> {
  const errors: string[] = [];
  let deviceCacheCleared = true;
  try {
    await clearDeviceCache();
  } catch (error) {
    deviceCacheCleared = false;
    errors.push(
      `IndexedDB: ${error instanceof Error ? error.message : "cache unavailable"}`,
    );
  }

  const paceKeys: string[] = [];
  let localStorageCleared = true;
  if (!storage) {
    localStorageCleared = false;
    errors.push("localStorage: inaccessible on this device");
  } else {
    try {
      const initialLength = storage.length;
      for (let index = 0; index < initialLength; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith("pace.") || key?.startsWith("lt.")) paceKeys.push(key);
      }
    } catch (error) {
      localStorageCleared = false;
      errors.push(
        `localStorage enumeration: ${error instanceof Error ? error.message : "storage unavailable"}`,
      );
    }

    for (const key of paceKeys) {
      try {
        storage.removeItem(key);
      } catch (error) {
        localStorageCleared = false;
        errors.push(
          `localStorage key ${key}: ${error instanceof Error ? error.message : "remove failed"}`,
        );
      }
    }
  }

  return { deviceCacheCleared, localStorageCleared, errors };
}


/** Access localStorage without letting a blocked getter abort other cleanup. */
export function getLocalStorageSafely(): LocalStorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}
