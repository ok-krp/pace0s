import test from "node:test";
import assert from "node:assert/strict";
import { shouldPersistLocalStateValue } from "./local-state-hydration.ts";

test("does not persist the previous key value while the new key hydrates", () => {
  const hydration = { pending: true, value: { account: "B" } };
  assert.equal(
    shouldPersistLocalStateValue({ account: "A" }, hydration),
    false,
  );
  assert.equal(hydration.pending, true);

  assert.equal(
    shouldPersistLocalStateValue({ account: "B" }, hydration),
    false,
  );
  assert.equal(hydration.pending, false);
  assert.equal(
    shouldPersistLocalStateValue({ account: "B" }, hydration),
    true,
  );
});

test("does not enqueue a remote value as a fresh local mutation", () => {
  const hydration = { pending: true, value: ["server value"] };
  assert.equal(shouldPersistLocalStateValue(["server value"], hydration), false);
  assert.equal(hydration.pending, false);
});

test("allows a real local mutation after hydration has completed", () => {
  const hydration = { pending: true, value: 1 };
  assert.equal(shouldPersistLocalStateValue(1, hydration), false);
  assert.equal(shouldPersistLocalStateValue(2, hydration), true);
});

test("supports initial primitive values that are identical to the fallback", () => {
  const hydration = { pending: true, value: 0 };
  assert.equal(shouldPersistLocalStateValue(0, hydration), false);
  assert.equal(hydration.pending, false);
});
