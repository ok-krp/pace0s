/**
 * Pace domain ownership registry.
 *
 * Each mutable domain has one canonical UI owner. Other surfaces may read the
 * domain or navigate to its owner, but must not maintain a second editor with
 * its own persistence logic. This is the architectural rule that prevents
 * stale shortcuts from overwriting newer values.
 */
export const DOMAIN_OWNER = {
  sleep: "/sleep",
  water: "/water",
  nutrition: "/nutrition",
  weight: "/body",
  habits: "/routine",
  focus: "/work",
  workouts: "/sport",
  finance: "/finance",
  calendar: "/calendar",
  notes: "/notes",
  groceries: "/shopping",
  health: "/watch",
  settings: "/settings",
} as const;

export type PaceDomain = keyof typeof DOMAIN_OWNER;

export function domainOwner(domain: PaceDomain) {
  return DOMAIN_OWNER[domain];
}
