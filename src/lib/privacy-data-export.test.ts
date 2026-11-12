import test from "node:test";
import assert from "node:assert/strict";
import { collectUserExportPages, USER_EXPORT_PAGE_SIZE } from "./privacy-data-export.ts";

test("fetches every row through multiple complete pages", async () => {
  const all = Array.from({length: USER_EXPORT_PAGE_SIZE * 2 + 7}, (_, i) => i);
  const ranges: Array<[number, number]> = [];
  const rows = await collectUserExportPages(async (from, to) => {
    ranges.push([from, to]);
    return {data: all.slice(from, to + 1), error: null};
  });
  assert.deepEqual(rows, all);
  assert.deepEqual(ranges, [
    [0, USER_EXPORT_PAGE_SIZE - 1],
    [USER_EXPORT_PAGE_SIZE, USER_EXPORT_PAGE_SIZE * 2 - 1],
    [USER_EXPORT_PAGE_SIZE * 2, USER_EXPORT_PAGE_SIZE * 3 - 1],
  ]);
});

test("stops after a short final page", async () => {
  let calls = 0;
  const rows = await collectUserExportPages(async () => {
    calls += 1;
    return {data: calls === 1 ? ["a", "b"] : [], error: null};
  }, 2);
  assert.deepEqual(rows, ["a", "b"]);
  assert.equal(calls, 2);
});

test("does not silently ignore page errors or invalid page size", async () => {
  await assert.rejects(
    collectUserExportPages(async () => ({data: null, error: {message: "permission denied"}})),
    /permission denied/,
  );
  await assert.rejects(
    collectUserExportPages(async () => ({data: [], error: null}), 0),
    RangeError,
  );
});
