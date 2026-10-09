import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/integrations/supabase/client.ts", import.meta.url), "utf8");

// A public client must not silently fall back to an unrelated/obsolete project.
assert.doesNotMatch(source, /jayzswkabxfhzmftagku\.supabase\.co/);
assert.doesNotMatch(source, /sb_publishable_[A-Za-z0-9_-]{12,}/);

// URL and key must be selected as a pair; mixed-source fallbacks are a regression.
assert.match(source, /const hasViteConfig = Boolean\(viteUrl \|\| viteKey\)/);
assert.match(source, /const hasServerConfig = Boolean\(serverUrl \|\| serverKey\)/);
assert.match(source, /url: viteUrl, key: viteKey/);
assert.match(source, /url: serverUrl, key: serverKey/);
assert.match(source, /Values from different pairs are never mixed/);
assert.match(source, /parsedUrl\.protocol !== "https:"/);

console.log("Supabase configuration contract: PASS");
