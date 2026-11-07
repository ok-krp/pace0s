const RESOLVED_TOOL_STATES = new Set([
  "approval-responded",
  "output-available",
  "output-denied",
  "output-error",
]);

/**
 * Approval responses must survive until convertToModelMessages processes them.
 * Only unfinished tool calls should be closed as interrupted.
 */
export function isResolvedToolState(state: unknown): boolean {
  return typeof state === "string" && RESOLVED_TOOL_STATES.has(state);
}
