import test from "node:test";
import assert from "node:assert/strict";
import { isResolvedToolState } from "./ai-tool-state.ts";

test("approved and denied tool decisions remain resolved", () => {
  for (const state of [
    "approval-responded",
    "output-available",
    "output-denied",
    "output-error",
  ]) {
    assert.equal(isResolvedToolState(state), true, state);
  }
});

test("unfinished or unknown tool states remain eligible for dangling-call closure", () => {
  for (const state of [
    "approval-requested",
    "input-available",
    "input-streaming",
    "unknown",
    null,
    undefined,
  ]) {
    assert.equal(isResolvedToolState(state), false, String(state));
  }
});
