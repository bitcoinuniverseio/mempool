import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PORTFOLIO_ROOT = fileURLToPath(new URL('.', import.meta.url));

function source(relativePath: string): string {
  return readFileSync(join(PORTFOLIO_ROOT, relativePath), 'utf8');
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return ['.html', '.scss', '.ts'].includes(extname(entry.name))
      ? [path]
      : [];
  });
}

describe('Portfolio mobile control floors', () => {
  it('does not declare a sub-44 CSS-pixel minimum for a Portfolio control', () => {
    for (const path of sourceFiles(PORTFOLIO_ROOT)) {
      const contents = readFileSync(path, 'utf8');
      for (const match of contents.matchAll(
        /min-(?:height|width)\s*:\s*(\d+(?:\.\d+)?)px/gi
      )) {
        expect(
          Number(match[1]),
          `${path} declares ${match[0]}`
        ).toBeGreaterThanOrEqual(44);
      }
    }
  });

  it.each([
    ['accounts/manage-portfolios.component.ts', 'input'],
    ['holdings/holdings.component.ts', 'input, select'],
    ['home/portfolio-home.component.ts', 'input'],
    ['onboarding/onboarding.component.ts', 'input, textarea'],
    ['reports/report-builder.component.ts', 'select'],
    ['settings/portfolio-settings.component.ts', 'input'],
    ['time-machine/time-machine.component.ts', 'input'],
    ['utxos/utxo-center.component.ts', 'input'],
  ])('%s keeps its mobile %s text at 16 CSS pixels', (path, selector) => {
    const contents = source(path);
    const media = contents.slice(contents.indexOf('@media (max-width: 767px)'));
    const selectorPattern = selector
      .split(',')
      .map((part) => part.trim())
      .join('\\s*,\\s*');

    expect(media).toMatch(
      new RegExp(`${selectorPattern}\\s*\\{\\s*font-size:\\s*16px;\\s*\\}`)
    );
  });
});
