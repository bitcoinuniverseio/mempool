import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const template = readFileSync(
  new URL('./chain-dashboard.component.html', import.meta.url),
  'utf8'
);

describe('chain dashboard template', () => {
  it('places the block timeline before a degraded-chain explanation', () => {
    const statusRail = template.indexOf('class="status-rail"');
    const timeline = template.indexOf('class="panel timeline-panel"');
    const notReady = template.indexOf('class="not-ready"');

    expect(statusRail).toBeGreaterThan(-1);
    expect(timeline).toBeGreaterThan(statusRail);
    expect(notReady).toBeGreaterThan(timeline);
  });
});
