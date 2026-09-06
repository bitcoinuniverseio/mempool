import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const artifact = dirname(fileURLToPath(import.meta.url));
const repo = process.env.SCROLLER_TEST_REPO || 'D:/universe/mempool/.tmp/explorer-health-cc524f6d97b5';
const require = createRequire(join(repo, 'frontend/package.json'));
const ts = require('typescript');
const { parseTemplate } = await import(pathToFileURL(require.resolve('@angular/compiler')).href);
const modes = new Map();
let occurrences = 0;
for (const shard of readdirSync(artifact).filter(name => name.startsWith('artifacts-mobile-'))) {
  const report = JSON.parse(readFileSync(join(artifact, shard, 'mobile-report.json'), 'utf8'));
  for (const row of report.report) for (const scroller of row.scrollers) {
    if (scroller.declared) continue;
    occurrences++;
    const [owner, element] = scroller.el.split(' ');
    const tags = modes.get(owner) ?? new Set();
    tags.add(element.startsWith('pre.') ? 'pre' : 'table');
    modes.set(owner, tags);
  }
}

function files(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(join(root, entry.name)) : [join(root, entry.name)]);
}
function targetTags(source, allowed) {
  return [...source.matchAll(/<(?:div|pre)\b(?:[^>"']|"[^"]*"|'[^']*')*>/g)].filter(match =>
    allowed.has('pre') && match[0].startsWith('<pre') ||
    allowed.has('table') && /\bclass="[^"]*\btable-responsive\b/.test(match[0]));
}
function inlineTemplate(source, file) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let template;
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'template') template = node.initializer.text;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(typeof template, 'string', `${file}: expected inline component template`);
  return template;
}
const escapeAttr = text => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const results = [];
const foundOwners = new Set();
for (const absolute of files(join(repo, 'frontend/src/app/universe')).filter(file => file.endsWith('.component.ts'))) {
  let source = readFileSync(absolute, 'utf8');
  const selector = source.match(/selector:\s*'([^']+)'/)?.[1];
  if (!modes.has(selector)) continue;
  foundOwners.add(selector);
  const matched = targetTags(source, modes.get(selector));
  assert.ok(matched.length, `${selector}: audit target has no matching source container`);
  const changes = matched.map((match, index) => {
    const headings = [...source.slice(0, match.index).matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/g)];
    let title = headings.at(-1)?.[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (selector === 'app-developer-platform' && index === 0) title = 'Scoped API keys';
    assert.ok(title && !title.includes('{{'), `${selector}: needs an explicit meaningful scroll region name`);
    return { start: match.index, tag: match[0], label: `${title}, scroll horizontally` };
  });
  if (process.argv.includes('--apply')) {
    for (const change of changes.toReversed()) {
      assert.ok(!/\b(?:tabindex|role|aria-label)=/.test(change.tag), `${selector}: preserve existing accessibility attributes`);
      const replacement = change.tag.replace(/>$/, ` tabindex="0" role="region" aria-label="${escapeAttr(change.label)}" i18n-aria-label>`);
      source = source.slice(0, change.start) + replacement + source.slice(change.start + change.tag.length);
    }
    writeFileSync(absolute, source);
  }
  const template = inlineTemplate(source, absolute);
  const parseErrors = parseTemplate(template, absolute).errors ?? [];
  const issues = parseErrors.map(error => String(error));
  for (const match of targetTags(source, modes.get(selector))) {
    for (const [name, expression] of [
      ['keyboard focus', /\btabindex="0"/],
      ['region role', /\brole="region"/],
      ['meaningful accessible name and scroll guidance', /\baria-label="[^"<>]+, scroll horizontally"/],
      ['translatable accessible name', /\bi18n-aria-label(?:\s|>)/],
    ]) if (!expression.test(match[0])) issues.push(`${name}: ${match[0]}`);
  }
  results.push({ file: absolute.slice(resolve(repo).length + 1).replaceAll('\\', '/'), selector, containers: changes.length, labels: changes.map(change => change.label), issues });
}
assert.deepEqual([...foundOwners].sort(), [...modes.keys()].sort(), 'every audit owner must map to current source');
const failing = results.filter(result => result.issues.length);
const output = {
  scope: 'source annotations and Angular template parsing only; browser audit remains required',
  recordedAt: new Date().toISOString(), occurrences, componentFiles: results.length,
  containers: results.reduce((total, result) => total + result.containers, 0),
  passed: failing.length === 0, failingFiles: failing.length, results,
};
writeFileSync(join(artifact, `scroller-source-${failing.length ? 'failing-first' : 'passing'}.json`), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ ...output, results: undefined }, null, 2));
for (const result of failing) console.log(`${result.selector}: ${result.issues.length} source issues`);
assert.equal(failing.length, 0, 'all audited scroll containers must be named keyboard-accessible regions');
