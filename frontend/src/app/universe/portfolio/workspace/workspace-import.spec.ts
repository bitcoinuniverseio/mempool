import { describe, expect, it } from 'vitest';

import { MAXIMUM_IMPORT_ROWS, importCsv, importJson, isSecretLike } from './workspace-import';

describe('importCsv', () => {
  it('reads a headed file with quoted labels', () => {
    const csv = [
      'address,chain,network,label,group',
      'bc1qexample000000000000,bitcoin,mainnet,"Cold, deep storage",savings',
    ].join('\n');
    const result = importCsv(csv);
    expect(result.rejections).toHaveLength(0);
    expect(result.entries).toEqual([{
      address: 'bc1qexample000000000000',
      chain: 'bitcoin',
      network: 'mainnet',
      label: 'Cold, deep storage',
      group: 'savings',
    }]);
  });

  it('defaults chain and network when the file omits them', () => {
    const result = importCsv('bc1qexample000000000000');
    expect(result.entries[0]).toMatchObject({ chain: 'bitcoin', network: 'mainnet' });
  });

  it('rejects a bad address with its row number, and keeps going', () => {
    const csv = [
      'address,chain,network,label,group',
      'bc1qexample000000000000,bitcoin,mainnet,ok,',
      'tooshort,bitcoin,mainnet,bad,',
    ].join('\n');
    const result = importCsv(csv);
    expect(result.entries).toHaveLength(1);
    expect(result.rejections).toEqual([{
      row: 2,
      reason: 'The address is not the shape of an address.',
    }]);
  });

  it('refuses key material before reading it in', () => {
    const wif = '5Kb8kLf9zgWQnogidDA76MzPL6TsZZY36hWXMssSzNydYXYB9KF';
    const result = importCsv(`${wif},bitcoin,mainnet,accident,`);
    expect(result.entries).toHaveLength(0);
    expect(result.rejections[0].reason).toContain('key material');
  });

  it('drops duplicate rows as named rejections', () => {
    const csv = [
      'bc1qexample000000000000',
      'bc1qexample000000000000',
    ].join('\n');
    const result = importCsv(csv);
    expect(result.entries).toHaveLength(1);
    expect(result.rejections[0].reason).toContain('duplicate');
  });

  it('states the cut when the file exceeds the row limit', () => {
    const rows = Array.from({ length: MAXIMUM_IMPORT_ROWS + 3 }, (_, i) => `bc1qexample${String(i).padStart(6, '0')}`).join('\n');
    const result = importCsv(rows);
    expect(result.entries).toHaveLength(MAXIMUM_IMPORT_ROWS);
    expect(result.rejections.some((rejection) => rejection.reason.includes('limit'))).toBe(true);
  });
});

describe('importJson', () => {
  it('reads a list of entries', () => {
    const json = JSON.stringify([{
      address: 'bc1qexample000000000000', chain: 'bitcoin', network: 'mainnet', label: 'main', group: 'hot',
    }]);
    const result = importJson(json);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].label).toBe('main');
  });

  it('says so for a file that is not JSON', () => {
    expect(importJson('{oops').rejections[0].reason).toContain('not valid JSON');
  });

  it('says so for a file with no list in it', () => {
    expect(importJson('"just a string"').rejections[0].reason).toContain('no list');
  });
});

describe('isSecretLike', () => {
  it('guards the same shapes the command center guards', () => {
    expect(isSecretLike('xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi')).toBe(true);
    expect(isSecretLike('bc1qexample000000000000')).toBe(false);
  });
});
