import test from "node:test";
import assert from "node:assert/strict";
import { fetchAllKeysetPages } from "./user-state-pagination.ts";

type Row = { key: string; value: number };

test("fetches exact and partial keyset pages without skipping rows", async () => {
  const source: Row[] = ["a", "b", "c", "d", "e"].map((key, value) => ({ key, value }));
  const cursors: Array<string | null> = [];

  const rows = await fetchAllKeysetPages<Row>(async (afterKey, limit) => {
    cursors.push(afterKey);
    const start = afterKey === null ? 0 : source.findIndex((row) => row.key === afterKey) + 1;
    return { data: source.slice(start, start + limit), error: null };
  }, { pageSize: 2 });

  assert.deepEqual(rows, source);
  assert.deepEqual(cursors, [null, "b", "d"]);
});

test("does not return a partial collection when a later page fails", async () => {
  let calls = 0;
  const rows = await fetchAllKeysetPages<Row>(async () => {
    calls++;
    if (calls === 1) return { data: [{ key: "a", value: 1 }, { key: "b", value: 2 }], error: null };
    return { data: null, error: new Error("temporary PostgREST failure") };
  }, { pageSize: 2 });

  assert.equal(rows, null);
  assert.equal(calls, 2);
});

test("rejects a page that repeats the previous cursor", async () => {
  let calls = 0;
  const rows = await fetchAllKeysetPages<Row>(async () => {
    calls++;
    return calls === 1
      ? { data: [{ key: "a", value: 1 }, { key: "b", value: 2 }], error: null }
      : { data: [{ key: "b", value: 3 }, { key: "c", value: 4 }], error: null };
  }, { pageSize: 2 });

  assert.equal(rows, null);
  assert.equal(calls, 2);
});

test("stops without applying a page when cancellation occurs in flight", async () => {
  let cancelled = false;
  let calls = 0;
  const rows = await fetchAllKeysetPages<Row>(async () => {
    calls++;
    cancelled = true;
    return { data: [{ key: "a", value: 1 }], error: null };
  }, { pageSize: 2, isCancelled: () => cancelled });

  assert.equal(rows, null);
  assert.equal(calls, 1);
});

test("rejects invalid page sizes", async () => {
  await assert.rejects(
    () => fetchAllKeysetPages<Row>(async () => ({ data: [], error: null }), { pageSize: 0 }),
    RangeError,
  );
});
