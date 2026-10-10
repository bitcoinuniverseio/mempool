import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const root = new URL('../../', import.meta.url);
const require = createRequire(new URL('backend/package.json', root));
const ts = require('typescript');
function literals(path) {
  const source = ts.createSourceFile(path, readFileSync(new URL(path, root), 'utf8'), ts.ScriptTarget.Latest, true);
  const found = [];
  function visit(node) { if (ts.isStringLiteral(node)) found.push(node.text); ts.forEachChild(node, visit); }
  visit(source); return found;
}
test('shared frontend v1 scope remains the exact native producer and declared contract identity', () => {
  const scope = literals('frontend/src/app/shared/liquid-observatory-wire.ts')[0];
  assert.equal(scope, 'canonical-public-blocks-and-parent-peg-evidence');
  for (const path of ['backend/src/api/liquid-observatory/liquid-observatory.service.ts', 'backend/src/api/liquid-observatory/liquid-observatory.types.ts']) {
    assert.ok(literals(path).includes(scope), `${path} must emit/declare the exact v1 identity`);
  }
});
