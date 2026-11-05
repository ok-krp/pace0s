export type PendingHydratedValue<T> = {
  pending: boolean;
  value: T;
};

/**
 * Returns true only after the hydration token has been consumed. If React has
 * not committed the hydrated value yet (for example after a key change), the
 * caller must wait rather than persisting the previous key's state.
 */
export function shouldPersistLocalStateValue<T>(
  currentValue: T,
  hydration: PendingHydratedValue<T> | null,
): boolean {
  if (!hydration?.pending) return true;
  if (!Object.is(currentValue, hydration.value)) return false;
  hydration.pending = false;
  return false;
}
