import test from "node:test";
import assert from "node:assert/strict";
import { authenticateMcpRequest, extractMcpBearerToken } from "./auth.ts";

test("extracts a bearer token without accepting other authorization schemes", () => {
  const request = (authorization: string | null) => new Request("https://pace.example/mcp", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });

  assert.equal(extractMcpBearerToken(request("Bearer abc.def.ghi")), "abc.def.ghi");
  assert.equal(extractMcpBearerToken(request("bearer token")), "token");
  assert.equal(extractMcpBearerToken(request("Basic abc")), null);
  assert.equal(extractMcpBearerToken(request("Bearer")), null);
  assert.equal(extractMcpBearerToken(request("Bearer token extra")), null);
  assert.equal(extractMcpBearerToken(request(null)), null);
});

test("fails closed when no bearer token is present", async () => {
  const response = await authenticateMcpRequest(new Request("https://pace.example/mcp", { method: "POST" }));
  assert.deepEqual(response, {
    ok: false,
    status: 401,
    message: "A Supabase OAuth bearer token is required.",
  });
});

test("fails closed when Supabase server credentials are missing", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  try {
    const response = await authenticateMcpRequest(new Request("https://pace.example/mcp", {
      method: "POST",
      headers: { authorization: "Bearer valid-looking-token" },
    }));
    assert.deepEqual(response, {
      ok: false,
      status: 503,
      message: "MCP authentication is not configured.",
    });
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = previousKey;
  }
});
