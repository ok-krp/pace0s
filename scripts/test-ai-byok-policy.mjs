import fs from "node:fs";
import assert from "node:assert/strict";

const provider = fs.readFileSync("src/lib/ai-provider.server.ts", "utf8");
const chat = fs.readFileSync("src/lib/ai-chat.server.ts", "utf8");
const settings = fs.readFileSync("src/components/AiSettings.tsx", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260821103000_ai_byok.sql", "utf8");

for (const name of ["openai", "anthropic", "gemini", "openrouter", "custom"]) assert.match(provider, new RegExp(`\\b${name}\\b`), `${name} provider missing`);
assert.match(provider, /aes-256-gcm/, "BYOK secrets must use authenticated encryption");
assert.match(provider, /encrypted_api_key/, "encrypted secret column missing");
assert.doesNotMatch(provider, /localStorage/, "BYOK secrets must not use localStorage");
assert.doesNotMatch(chat, /GEMINI_API_KEY/, "chat handler must not bypass provider selection with a hard-coded Gemini key");
assert.match(chat, /getAiRuntimeConfig/, "chat handler must resolve its provider at runtime");
assert.match(chat, /runtime\.source === \"byok\"/, "chat handler must distinguish BYOK from Pace AI");
assert.match(settings, /Ma propre clé API/, "BYOK UI option missing");
assert.match(settings, /Tester la connexion/, "connection test UI missing");
assert.match(settings, /Supprimer la clé/, "key deletion UI missing");
assert.match(migration, /ai_provider_secrets/, "secret table migration missing");
assert.match(migration, /ROW LEVEL SECURITY/, "secret table RLS missing");
assert.match(migration, /encrypted_api_key/, "secret encryption storage missing");

console.log("BYOK policy checks passed");
