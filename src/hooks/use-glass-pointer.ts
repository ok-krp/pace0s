/**
 * Mouse-following Liquid Glass effect is intentionally disabled.
 *
 * Pace keeps the static glass treatment, but does not attach pointermove
 * listeners, mutate CSS variables on pointer movement, or run an FPS
 * watchdog. This avoids unnecessary work and keeps the UI stable on
 * desktop while preserving the existing hook API.
 */
export function useGlassPointer() {
  // Intentionally disabled.
}
