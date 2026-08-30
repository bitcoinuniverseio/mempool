/**
 * Regression cover for the docs manifest and its template anchors.
 *
 * The manifest is the contract: the sidebar, the deep links, and this spec
 * all read it. If a required section is dropped from the manifest, or a
 * section loses its anchor in the template, a deep link dies silently, so
 * both are asserted here. The template is read as text rather than rendered:
 * the suite runs without a DOM, and the AOT production build already fails
 * on any template error.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DOCS_SECTIONS,
  docsSectionsFor,
} from '@app/universe/chain-docs/chain-docs-content';

const REQUIRED_BOTH = [
  'overview',
  'dashboard',
  'timeline',
  'candidate-blocks',
  'fees',
  'mempool',
  'lookups',
  'mining',
  'pool-attribution',
  'charts',
  'freshness',
  'api',
  'versions',
] as const;

const template = readFileSync(
  new URL('./chain-docs.component.html', import.meta.url),
  'utf8'
);

/** Anchor ids as the template declares them, in document order. */
function templateSectionIds(): string[] {
  return [
    ...template.matchAll(/<section class="panel docs-section" id="([a-z-]+)"/g),
  ].map((match) => match[1]);
}

describe('docs section manifest', () => {
  it('offers every required section on both chains', () => {
    for (const chain of ['dogecoin', 'zcash'] as const) {
      const ids = docsSectionsFor(chain).map((section) => section.id);
      for (const required of REQUIRED_BOTH) {
        expect(ids, `${chain} is missing ${required}`).toContain(required);
      }
    }
  });

  it('includes privacy for zcash and not for dogecoin', () => {
    expect(docsSectionsFor('zcash').map((s) => s.id)).toContain('privacy');
    expect(docsSectionsFor('dogecoin').map((s) => s.id)).not.toContain(
      'privacy'
    );
  });

  it('has no duplicate ids and a title for every section', () => {
    const ids = DOCS_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of DOCS_SECTIONS) {
      expect(section.title.length).toBeGreaterThan(0);
    }
  });
});

describe('docs template anchors', () => {
  it('declares one section anchor per manifest id', () => {
    const anchors = templateSectionIds();
    expect([...anchors].sort()).toEqual(
      DOCS_SECTIONS.map((section) => section.id).sort()
    );
  });

  it('keeps the anchors in manifest order so the sidebar tracks the page', () => {
    expect(templateSectionIds()).toEqual(
      DOCS_SECTIONS.map((section) => section.id)
    );
  });

  it('gives every section a heading', () => {
    // Each anchor opens with its h2 before any other section starts.
    const sections = template.split('<section class="panel docs-section"');
    for (const chunk of sections.slice(1)) {
      const body = chunk.split('</section>')[0];
      expect(body).toContain('<h2');
    }
  });

  it('gates the privacy section to zcash', () => {
    const match = template.match(
      /<section class="panel docs-section" id="privacy"[^>]*>/
    );
    expect(match).not.toBeNull();
    expect(match![0]).toContain(`*ngIf="chain === 'zcash'"`);
  });
});
