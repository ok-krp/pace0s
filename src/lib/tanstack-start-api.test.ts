
import test from "node:test";
import assert from "node:assert/strict";
import { createMiddleware, createServerFn } from "@tanstack/react-start";

test("TanStack Start function middleware exposes validator and not the removed inputValidator alias", () => {
  const middleware = createMiddleware({ type: "function" })
    .validator((data: unknown) => data)
    .server(async ({ next }) => next());

  const builder = createServerFn({ method: "POST" }).middleware([middleware]);

  assert.equal(typeof builder.validator, "function");
  assert.equal("inputValidator" in builder, false);

  const serverFunction = builder
    .validator((data: unknown) => data)
    .handler(async () => ({ ok: true }));

  assert.equal(typeof serverFunction, "function");
});
