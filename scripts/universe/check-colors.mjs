#!/usr/bin/env node
/**
 * Raw colour gate.
 *
 * A colour literal written into a component is a colour that no theme can
 * reach. That is the single mechanism behind every contrast failure this
 * product has shipped: a global token layer was added, the component rules kept
 * their own literals, and the literals won because they are more specific.
 *
 * So new ones are refused. Interface colour comes from a semantic token; the
 * exceptions are listed below with a reason and an owner, and each one is
 * either covered by an automated contrast test or is not ours to change.
 *
 * Usage:
 *   node scripts/universe/check-colors.mjs [path ...]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

const SKIPPED_DIRECTORIES = new Set([
  '.git', 'node_modules', 'dist', 'build', 'target', 'coverage', '.angular', '.cache',
]);

const SCANNED_EXTENSIONS = new Set(['.scss', '.css', '.html', '.ts', '.js', '.mjs', '.svg']);

/**
 * Every remaining literal, why it stays, and who answers for it.
 *
 * `paths` are matched as prefixes against the repository-relative path.
 */
const ALLOWLIST = [
  {
    paths: ['frontend/src/styles/_universe-tokens.scss', 'frontend/src/theme-dark.scss', 'frontend/src/theme-contrast.scss'],
    reason:
      'The token definitions themselves. This is the one place a literal is allowed, ' +
      'because it is the place every other colour resolves to. Held to its contrast ' +
      'floors by scripts/universe/check-palettes.mjs.',
    owner: 'Universe Explorer design system',
  },
  {
    paths: ['frontend/src/app/app.constants.ts'],
    reason:
      'The fee scale and the inherited categorical ramp. These are data palettes, not ' +
      'interface colour: a fee band means a fee rate. Every ink printed on them, and ' +
      'the plate that protects text over them, is measured by check-palettes.mjs.',
    owner: 'Universe Explorer design system',
  },
  {
    paths: ['frontend/src/app/shared/chart-theme.ts'],
    reason:
      'Fallback values used only when no document is available, so a server-rendered ' +
      'or test-harness chart still draws something readable. They mirror the light ' +
      'tokens and are covered by check-palettes.mjs.',
    owner: 'Universe Explorer design system',
  },
  {
    paths: ['frontend/src/app/components/mining-dashboard/', 'frontend/src/app/components/pool-ranking/'],
    reason:
      'Mining pool identity colours. A pool\'s colour belongs to the pool, and the ' +
      'swatch always appears beside the pool name, so colour never carries the ' +
      'identity on its own.',
    owner: 'Universe Explorer mining surfaces',
  },
  {
    paths: ['frontend/src/app/components/svg-images/svg-images.component.html'],
    reason:
      'Payment network marks, partner logos, and per-network identity glyphs. Those ' +
      'colours belong to the organisation the mark represents, not to this product. ' +
      'Every interface icon in the same sprite takes currentColor, so it inherits the ' +
      'contrast of the text beside it.',
    owner: 'Universe Explorer branding',
  },
  {
    paths: ['frontend/src/resources/', 'frontend/src/assets/'],
    reason: 'Third-party and brand assets. Not ours to recolour.',
    owner: 'Universe Explorer branding',
  },
  {
    paths: [
      'frontend/src/app/components/github-login.component/',
      'frontend/src/app/components/twitter-login/',
    ],
    reason:
      'Sign-in buttons for two outside services. Each platform requires its own button ' +
      'colour, and the label on it is set by the same rules. Not ours to change.',
    owner: 'Universe Explorer branding',
  },
  {
    paths: ['frontend/src/app/components/ngx-bootstrap-multiselect/'],
    reason:
      'A vendored third-party control kept in-tree to avoid a dependency. Its own ' +
      'markup, upstream. The surfaces around it are themed normally.',
    owner: 'Universe Explorer frontend',
  },
  {
    paths: ['frontend/src/app/components/start/start.component.scss'],
    reason:
      'The firework spray shown when the chain reaches a named event height. Pure ' +
      'decoration over a fixed dark backdrop, carrying no text and no information: ' +
      'the event itself is stated in words beside it.',
    owner: 'Universe Explorer chain surfaces',
  },
  {
    paths: ['scripts/universe/'],
    reason:
      'The gates and the visual QA harness. These exist to measure colour, so they ' +
      'have to be able to name one.',
    owner: 'Universe Explorer quality',
  },
  {
    paths: ['frontend/src/app/components/block-overview-graph/'],
    reason:
      'WebGL shader constants. These are compiled into GLSL, which cannot read a CSS ' +
      'custom property. The palette they draw is handed in from the token layer at ' +
      'theme-change time; these are the shader\'s own structural values.',
    owner: 'Universe Explorer Lens',
  },
];

/**
 * What counts as a colour literal. Deliberately narrow: this looks for values
 * assigned to something that paints, not for every hex-looking string, so a
 * transaction id or a git sha is never mistaken for a colour.
 */
const PATTERNS = [
  // CSS and SCSS declarations.
  {
    id: 'css-literal',
    regex:
      /(?:^|[\s;{])(?:-{2}[\w-]+|color|background|background-color|border|border-color|border-top|border-right|border-bottom|border-left|border-top-color|border-right-color|border-bottom-color|border-left-color|outline|outline-color|fill|stroke|box-shadow|text-shadow|caret-color|column-rule-color|text-decoration-color|stop-color|flood-color)\s*:\s*[^;{}]*?(#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d|\bhsla?\(\s*\d)/g,
    extensions: ['.scss', '.css'],
  },
  // Inline styles and SVG presentation attributes in templates.
  {
    id: 'markup-literal',
    regex: /(?:style\s*=\s*"|(?:fill|stroke|stop-color|flood-color)\s*=\s*")[^"]{0,160}?(#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d)/g,
    extensions: ['.html', '.svg'],
  },
  // Colour-valued properties in component code.
  {
    id: 'code-literal',
    regex:
      /\b(?:color|colour|colors|colours|backgroundColor|borderColor|itemColor|lineColor|fillColor|strokeColor|shadowColor|textColor|inactiveColor|areaColor|borderColorSaturation)\s*[:=]\s*(?:\[\s*)?['"`](#[0-9a-fA-F]{3,8}|rgba?\(\s*\d[^'"`]*)['"`]/g,
    extensions: ['.ts', '.js', '.mjs'],
  },
];

const args = process.argv.slice(2);
const targets = args.length ? args.map((a) => resolve(ROOT, a)) : [resolve(ROOT, 'frontend/src'), resolve(ROOT, 'scripts')];

function allowanceFor(relativePath) {
  const normalised = relativePath.split(sep).join('/');
  return ALLOWLIST.find((entry) => entry.paths.some((p) => normalised.startsWith(p)));
}

function* walk(path) {
  const stats = statSync(path);
  if (stats.isFile()) {
    yield path;
    return;
  }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      yield* walk(join(path, entry.name));
    } else if (entry.isFile()) {
      yield join(path, entry.name);
    }
  }
}

const findings = [];
const allowed = new Map();

for (const target of targets) {
  for (const file of walk(target)) {
    const extension = file.slice(file.lastIndexOf('.'));
    if (!SCANNED_EXTENSIONS.has(extension)) continue;

    const relativePath = relative(ROOT, file);
    const allowance = allowanceFor(relativePath);

    // `url(#someId)` names a gradient or a filter, not a colour, and an id can
    // spell a valid hex triplet. Blank those out before matching so a
    // reference is never reported as a literal.
    const source = readFileSync(file, 'utf8').replace(/url\(\s*#[^)]*\)/g, 'url(_)');
    const lines = source.split(/\r?\n/);

    for (const pattern of PATTERNS) {
      if (!pattern.extensions.includes(extension)) continue;
      pattern.regex.lastIndex = 0;
      let match;
      while ((match = pattern.regex.exec(source)) !== null) {
        const line = source.slice(0, match.index).split(/\r?\n/).length;
        const text = (lines[line - 1] || '').trim();
        // A commented-out rule is not a rule.
        if (/^(\/\/|\*|\/\*|<!--)/.test(text)) continue;
        if (allowance) {
          allowed.set(allowance, (allowed.get(allowance) || 0) + 1);
        } else {
          findings.push({ file: relativePath.split(sep).join('/'), line, value: match[1], text: text.slice(0, 110) });
        }
      }
    }
  }
}

if (allowed.size) {
  console.log('Allowlisted literals:');
  for (const entry of ALLOWLIST) {
    const count = allowed.get(entry);
    if (!count) continue;
    console.log(`  ${String(count).padStart(4)}  ${entry.owner}: ${entry.paths[0]}${entry.paths.length > 1 ? ` (+${entry.paths.length - 1} more)` : ''}`);
  }
  console.log();
}

if (!findings.length) {
  console.log('No raw interface colour outside the allowlist.');
  process.exit(0);
}

console.error(`${findings.length} raw interface colour literal(s) outside the allowlist:\n`);
for (const finding of findings) {
  console.error(`  ${finding.file}:${finding.line}  ${finding.value}`);
  console.error(`    ${finding.text}`);
}
console.error(
  '\nInterface colour comes from a semantic token. If a literal genuinely has to stay,' +
    '\nadd it to ALLOWLIST in this file with a reason and an owner, and make sure a' +
    '\ncontrast test covers it.',
);
process.exit(1);
