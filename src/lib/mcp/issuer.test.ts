import test from "node:test";
import assert from "node:assert/strict";
import { resolveSupabaseAuthIssuer } from "./issuer.ts";

test("uses the server Supabase URL as the OAuth issuer source of truth", () => {
  assert.equal(
    resolveSupabaseAuthIssuer("https://pace-project.supabase.co/"),
    "https://pace-project.supabase.co/auth/v1",
  );
  assert.equal(
    resolveSupabaseAuthIssuer("https://auth.example.com/custom/path", "stale-project-ref"),
    "https://auth.example.com/auth/v1",
  );
});

test("allows loopback HTTP only for local Supabase development", () => {
  assert.equal(
    resolveSupabaseAuthIssuer("http://127.0.0.1:54321"),
    "http://127.0.0.1:54321/auth/v1",
  );
  assert.equal(
    resolveSupabaseAuthIssuer("http://localhost:54321"),
    "http://localhost:54321/auth/v1",
  );
});

test("falls back to the project ref only when the server URL is absent", () => {
  assert.equal(
    resolveSupabaseAuthIssuer(undefined, "abcdefghijklmnopqrst"),
    "https://abcdefghijklmnopqrst.supabase.co/auth/v1",
  );
  assert.equal(
    resolveSupabaseAuthIssuer(undefined, undefined),
    "https://project-ref-unset.supabase.co/auth/v1",
  );
});

test("rejects insecure non-local Supabase URLs", () => {
  assert.throws(
    () => resolveSupabaseAuthIssuer("http://db.example.com"),
    /must use HTTPS/,
  );
});
