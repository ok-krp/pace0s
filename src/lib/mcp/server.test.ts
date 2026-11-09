import test from "node:test";
import assert from "node:assert/strict";
import { handleMcpRequest } from "./server.ts";

test("rejects GET on the stateless MCP endpoint", async () => {
  const response = await handleMcpRequest(new Request("https://pace.example/mcp", { method: "GET" }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST, OPTIONS");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
});

test("supports preflight without exposing authenticated resources", async () => {
  const response = await handleMcpRequest(new Request("https://pace.example/mcp", { method: "OPTIONS" }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("allow"), "POST, OPTIONS");
});

test("returns an OAuth bearer challenge with the protected-resource metadata URL", async () => {
  const response = await handleMcpRequest(new Request("https://pace.example/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } } }),
  }));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.match(response.headers.get("www-authenticate") ?? "", /resource_metadata="https:\/\/pace\.example\/\.well-known\/oauth-protected-resource"/);
  const body = await response.json() as { error?: string };
  assert.equal(body.error, "unauthorized");
});
