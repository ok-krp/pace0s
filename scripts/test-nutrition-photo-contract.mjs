import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const route = read("src/routes/nutrition.tsx");
const ai = read("src/lib/nutrition-ai.functions.ts");
const shared = read("src/lib/nutrition-ai.shared.ts");
const bucketMigration = read("supabase/migrations/20260830170000_nutrition_ai_storage.sql");

// Model IDs and fallback classification must stay on supported Google models,
// including SDK error objects that expose statusCode instead of status.
assert.match(ai, /const PHOTO_AI_MODEL = "google\/gemini-3\.8-flash"/);
assert.match(ai, /const FALLBACK_AI_MODEL = "google\/gemini-3\.6-flash"/);
assert.match(ai, /candidate\?\.statusCode/);
assert.match(ai, /candidate\?\.response\?\.status/);
assert.match(ai, /getGeminiModel\(PHOTO_AI_MODEL\)/);

// The browser upload stays below the private bucket's 8 MiB hard limit and
// only accepts formats that the server and bucket permit.
assert.match(route, /const MAX_UPLOAD_BYTES = 6\.5 \* 1024 \* 1024/);
assert.match(route, /\["image\/jpeg", "image\/png", "image\/webp"\]/);
assert.match(route, /supabase\.storage\.from\("nutrition-ai"\)\.upload/);
assert.match(route, /analyzePhoto\(\{ data: \{ storagePath \} \}\)/);
assert.match(bucketMigration, /values \('nutrition-ai', 'nutrition-ai', false, 8388608, array\['image\/jpeg','image\/png','image\/webp'\]/);

// The server remains the authority for consent, user-owned object paths,
// image download, and cleanup. The test deliberately does not call production AI.
assert.match(ai, /context\.supabase\.from\("legal_consent"\)/);
assert.match(ai, /storagePathForUser\(context\.userId, data\.storagePath\)/);
assert.match(ai, /context\.supabase\.storage\.from\(PHOTO_BUCKET\)\.download\(path!\)/);
assert.match(ai, /finally \{ if \(path\) await context\.supabase\.storage\.from\(PHOTO_BUCKET\)\.remove\(\[path\]\)/);
assert.match(shared, /export const AI_MODEL = "google\/gemini-3\.8-flash"/);

console.log("nutrition-photo-contract-test: PASS");
