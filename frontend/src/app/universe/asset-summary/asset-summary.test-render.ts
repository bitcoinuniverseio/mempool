import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ɵresolveComponentResources as resolveComponentResources } from '@angular/core';

/**
 * Makes `templateUrl` components renderable under the unit-test runner.
 *
 * The suite runs outside the Angular CLI, so nothing has inlined the external
 * template and stylesheet references a component declares, and the TestBed
 * refuses to create such a component. Without this, template correctness would
 * only ever be checked by the production build, and a lost table semantic or a
 * missing aria attribute would ship until somebody opened the page.
 *
 * The real template file is read from disk, so these tests assert against the
 * template that ships rather than against a copy kept in a test. Stylesheets
 * resolve to nothing: they are Sass, which is the build's job to compile, and no
 * assertion here depends on a computed style.
 */
export async function resolveTemplates(
  specUrl: string,
  relativeBase = '.',
): Promise<void> {
  // A component's templateUrl is relative to the component, not to whichever
  // spec renders it, so a spec in another directory says where to look.
  const base = resolve(dirname(fileURLToPath(specUrl)), relativeBase);
  await resolveComponentResources((url: string) => {
    if (url.endsWith('.scss') || url.endsWith('.css')) {
      return Promise.resolve({ text: () => Promise.resolve('') } as Response);
    }
    const text = readFileSync(resolve(base, url), 'utf8');
    return Promise.resolve({ text: () => Promise.resolve(text) } as Response);
  });
}
