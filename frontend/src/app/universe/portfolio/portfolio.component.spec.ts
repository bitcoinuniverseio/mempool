import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const template = readFileSync(
  new URL('./portfolio.component.html', import.meta.url),
  'utf8',
);

describe('PortfolioComponent public availability copy', () => {
  it('keeps backend diagnostics out of the public portfolio', () => {
    expect(template).toContain('Some portfolio details are unavailable');
    expect(template).toContain('Some details for this protocol are unavailable right now.');
    expect(template).toContain('Some information used for this calculation is unavailable right now.');
    expect(template).not.toContain('let warning of summary.envelope.warnings');
    expect(template).not.toContain('let warning of statement.warnings');
    expect(template).not.toContain('let warning of report.warnings');
  });
});
