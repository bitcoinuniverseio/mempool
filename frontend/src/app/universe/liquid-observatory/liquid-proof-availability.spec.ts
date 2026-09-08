import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const template = readFileSync(
  new URL('./liquid-observatory.component.html', import.meta.url),
  'utf8'
);

describe('Liquid asset proof labels', () => {
  it('states proof availability without claiming verification', () => {
    expect(template).toContain('Proof available');
    expect(template).toContain('Proof unavailable');
    expect(template).not.toContain('? "Verified"');
  });
});
