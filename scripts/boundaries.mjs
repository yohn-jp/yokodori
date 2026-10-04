import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const exports = JSON.parse(readFileSync('package.json', 'utf8')).exports;
assert.deepEqual(Object.keys(exports).sort(), ['.', './pi']);
for (const name of ['core/context', 'compiler/initial', 'adapters/pi/index']) {
  try { await import(`yokodori/${name}`); assert.fail(`Internal subpath exported: ${name}`); }
  catch (error) { assert.equal(error.code, 'ERR_PACKAGE_PATH_NOT_EXPORTED'); }
}
function visit(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) visit(path);
    else if (path.endsWith('.ts')) {
      const source = readFileSync(path, 'utf8');
      if (!path.startsWith('src/adapters/pi/')) assert.doesNotMatch(source, /(?:from\s*|import\s*\(|require\s*\()\s*['"](?:@earendil-works\/pi-|pi-agent|pi-ai)/, path);
      if (path.startsWith('src/core/')) assert.doesNotMatch(source, /from\s*['"]\.\.\/\.\.\/(?:sdk|adapters|application)/, path);
    }
  }
}
visit('src');
