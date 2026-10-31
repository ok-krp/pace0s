import test from "node:test";
import assert from "node:assert/strict";
import { mcpDatabaseFailure } from "./errors.ts";

test("MCP database failures return a generic response without backend details", () => {
  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    const response = mcpDatabaseFailure("list_food_log", {
      code: "42501",
      message: "internal policy text must not be exposed",
    });
    assert.equal(response.isError, true);
    assert.equal(
      response.content[0].text,
      "Database operation failed. Please retry.",
    );
    assert.equal(JSON.stringify(response).includes("internal policy text"), false);
    assert.equal(JSON.stringify(logged).includes("42501"), true);
    assert.equal(JSON.stringify(logged).includes("internal policy text"), false);
  } finally {
    console.error = originalError;
  }
});
