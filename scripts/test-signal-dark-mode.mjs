import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile("src/visual-theme.css", "utf8");

// Signal's light palette intentionally overrides .text-white for contrast.
// In dark mode, a later, more-specific rule must restore readable white text.
assert.match(css, /\[data-visual-theme="signal"\] \.text-white\s*\{\s*color:\s*#111315\s*!important;/);
assert.match(css, /html\.dark\[data-visual-theme="signal"\]\s+\.text-white\s*\{\s*color:\s*#f5f7fa\s*!important;/);
assert.match(css, /html\.dark\[data-visual-theme="signal"\]\s+\.text-foreground[\s\S]*?color:\s*#f5f7fa\s*!important;/);

console.log("Signal dark-mode text contrast contract: PASS");
