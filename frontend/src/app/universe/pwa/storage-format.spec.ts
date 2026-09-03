import { describe, expect, it } from 'vitest';

import { formatBytes, storageSentence } from './storage-format';

describe('formatBytes', () => {
  it('says unknown when the browser said nothing', () => {
    expect(formatBytes(null)).toBe('unknown');
    expect(formatBytes(Number.NaN)).toBe('unknown');
    expect(formatBytes(-5)).toBe('unknown');
  });

  it('keeps small counts in bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
  });

  it('scales up through the units', () => {
    expect(formatBytes(1024)).toBe('1.00 KiB');
    expect(formatBytes(1536)).toBe('1.50 KiB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MiB');
    expect(formatBytes(3.25 * 1024 ** 3)).toBe('3.25 GiB');
  });

  it('shortens large values to whole units', () => {
    expect(formatBytes(2048 * 1024 * 1024 * 1024)).toBe('2.00 TiB');
    expect(formatBytes(120 * 1024 * 1024 * 1024)).toBe('120 GiB');
  });
});

describe('storageSentence', () => {
  it('refuses to invent a number the browser did not give', () => {
    expect(storageSentence(null, null)).toBe('The browser did not report how much is stored.');
    expect(storageSentence(null, 1024 ** 3)).toBe('The browser did not report how much is stored.');
  });

  it('states usage alone when there is no quota', () => {
    expect(storageSentence(2048, null)).toBe('2.00 KiB stored.');
  });

  it('states usage against the allowance with the share', () => {
    const quota = 1024 ** 3;
    const sentence = storageSentence(quota / 4, quota);
    expect(sentence).toContain('256 MiB stored');
    expect(sentence).toContain('(25%)');
  });

  it('survives a zero quota without dividing by nothing', () => {
    expect(storageSentence(10, 0)).toContain('(0%)');
  });
});
