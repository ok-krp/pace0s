import test from "node:test";
import assert from "node:assert/strict";
import { isValidIsoDateOnly } from "./validation.ts";

test("accepts valid ISO calendar dates including leap days", () => {
  for (const value of [
    "0001-01-01",
    "2000-02-29",
    "2024-02-29",
    "2026-10-30",
    "9999-12-31",
  ]) {
    assert.equal(isValidIsoDateOnly(value), true, value);
  }
});

test("rejects rollover dates and malformed date strings", () => {
  for (const value of [
    "1900-02-29",
    "2026-02-29",
    "2026-02-31",
    "2026-04-31",
    "2026-13-01",
    "2026-00-10",
    "0000-01-01",
    "26-01-01",
    "2026-1-01",
    "2026-01-1",
    "",
  ]) {
    assert.equal(isValidIsoDateOnly(value), false, value);
  }
});
