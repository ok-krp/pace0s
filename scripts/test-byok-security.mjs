import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const candidates = [
  'scripts/test-byok-security.mjs',
  'scripts/test-byok-security.js',
];

const existing = candidates.find((p) => fs.existsSync(path.join(root, p)));
if (!existing) {
  throw new Error('BYOK security regression script is missing');
}

console.log(`BYOK security regression script present: ${existing}`);
