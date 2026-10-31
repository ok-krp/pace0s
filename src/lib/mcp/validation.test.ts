import test from "node:test";
import assert from "node:assert/strict";
import { isOrderedIsoDateRange, isValidIsoDateOnly, isValidIsoTimestamp } from "./validation.ts";

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

test("accepts timezone-qualified ISO timestamps with valid dates", () => {
  for (const value of [
    "2026-10-30T12:30:00Z",
    "2026-10-30T12:30:00.123456789+01:00",
    "2000-02-29T23:59:59-0500",
  ]) {
    assert.equal(isValidIsoTimestamp(value), true, value);
  }
});

test("rejects invalid dates, clock values, and timezone-less timestamps", () => {
  for (const value of [
    "2026-02-31T12:00:00Z",
    "2026-10-30T25:00:00Z",
    "2026-10-30T12:60:00Z",
    "2026-10-30T12:00:00",
    "2026-10-30 12:00:00Z",
    "2026-10-30T12:00:00+25:00",
  ]) {
    assert.equal(isValidIsoTimestamp(value), false, value);
  }
});

test("accepts ordered and partially open date ranges", () => {
  assert.equal(isOrderedIsoDateRange("2026-10-01", "2026-10-30"), true);
  assert.equal(isOrderedIsoDateRange("2026-10-30", "2026-10-30"), true);
  assert.equal(isOrderedIsoDateRange(undefined, "2026-10-30"), true);
  assert.equal(isOrderedIsoDateRange("2026-10-01", undefined), true);
  assert.equal(isOrderedIsoDateRange(), true);
});

test("rejects an inverted food log date range", () => {
  assert.equal(isOrderedIsoDateRange("2026-10-31", "2026-10-30"), false);
});
