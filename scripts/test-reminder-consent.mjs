import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("src/routes/api/public/hooks/reminders.ts", "utf8");
const helperStart = source.indexOf("async function hasNotificationConsent");
const helperEnd = source.indexOf("async function alreadySent", helperStart);

assert.ok(helperStart >= 0, "scheduled reminders must have a notification-consent guard");
assert.ok(helperEnd > helperStart, "consent guard must be a separate helper");
const helper = source.slice(helperStart, helperEnd);

assert.match(helper, /\.from\("legal_consent"\)/, "consent must be checked against the server-side legal consent record");
assert.match(helper, /\.eq\("user_id", userId\)/, "consent lookup must be scoped to the reminder recipient");
assert.match(helper, /\.eq\("eula_version", LEGAL_VERSIONS\.eula\)/, "consent lookup must use the current EULA version");
assert.match(helper, /\.eq\("privacy_version", LEGAL_VERSIONS\.privacy\)/, "consent lookup must use the current privacy version");
assert.match(helper, /notifications\?\s*\)\?\.notifications === true/, "notifications must be explicitly opted in");
assert.match(helper, /if \(error\)[\s\S]*?throw new Error/, "consent lookup failures must fail closed");

const loopStart = source.indexOf("for (const row of (rows ?? []) as ReminderRow[])");
const consentCall = source.indexOf("await hasNotificationConsent(row.user_id, notificationConsentCache)", loopStart);
const duplicateCheck = source.indexOf("await alreadySent", loopStart);
const messageBuild = source.indexOf("await buildMessage", loopStart);
const pushCall = source.indexOf("await sendPush", loopStart);

assert.ok(loopStart >= 0, "scheduled reminder loop must exist");
assert.ok(consentCall > loopStart, "each reminder must check recipient consent");
assert.ok(consentCall < duplicateCheck, "consent must be checked before reminder-log reads");
assert.ok(consentCall < messageBuild, "consent must be checked before building personalized messages");
assert.ok(consentCall < pushCall, "consent must be checked before sending a push");
assert.match(
  source,
  /if \(!consentAllowed\)[\s\S]*?reason: "Consentement Notifications absent ou révoqué"[\s\S]*?continue;/,
  "reminders must be skipped and logged when consent is missing or revoked",
);

console.log("Reminder notification-consent regression checks passed.");
