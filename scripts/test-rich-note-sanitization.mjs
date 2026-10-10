import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isSafeLinkHref, sanitizeNoteHtml } from "../src/lib/sanitize-html.ts";

const sanitizer = readFileSync(new URL("../src/lib/sanitize-html.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../src/routes/work.tsx", import.meta.url), "utf8");
assert.match(sanitizer, /const ALLOWED_TAGS = new Set/);
assert.match(sanitizer, /DROP_WITH_CONTENT/);
assert.match(sanitizer, /isSafeLinkHref/);
assert.match(sanitizer, /if \(typeof DOMParser === "undefined"\) return escapeText\(html\);/);
assert.match(sanitizer, /if \(typeof DOMParser === "undefined"\) return html\.trim\(\);/);
assert.doesNotMatch(sanitizer, /html\.replace/);
assert.match(route, /innerHTML = sanitizeNoteHtml\(note\.html\)/);
assert.match(route, /html: sanitizeNoteHtml\(editorRef\.current\.innerHTML\)/);
assert.match(route, /htmlToPlainText\(sanitizeNoteHtml\(html\)\)/);
assert.doesNotMatch(route, /div\.innerHTML\s*=\s*html/);

// Exercise the server/SSR fallback: without DOMParser, untrusted markup must be
// encoded as text before it can ever be handed to an HTML sink.
const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
try {
  Object.defineProperty(globalThis, "DOMParser", {
    configurable: true,
    writable: true,
    value: undefined,
  });
  const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  assert.equal(
    sanitizeNoteHtml(payload),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;',
  );
} finally {
  if (originalDescriptor) Object.defineProperty(globalThis, "DOMParser", originalDescriptor);
  else delete globalThis.DOMParser;
}

// Scheme allowlist: only web and mail links are permitted, not script/data URLs.
assert.equal(isSafeLinkHref("https://example.com/path"), true);
assert.equal(isSafeLinkHref("http://example.com/path"), true);
assert.equal(isSafeLinkHref("mailto:help@example.com"), true);
for (const href of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)", "file:///etc/passwd"]) {
  assert.equal(isSafeLinkHref(href), false, `unsafe link scheme should be rejected: ${href}`);
}

console.log("Rich note sanitization static and SSR/link-policy tests: PASS");
