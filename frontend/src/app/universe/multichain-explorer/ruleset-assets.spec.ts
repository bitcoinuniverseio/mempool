import { describe, expect, it } from 'vitest';
import {
  readDecimals,
  readRulesetAsset,
  readRulesetAssetList,
} from '@app/universe/multichain-explorer/ruleset-assets';

/**
 * ZERO, as `/api/v1/zcash/protocols/zrc20/ZERO` returned it on 2026-08-29,
 * carrying only the fields this reading looks at. Nothing is paraphrased: the
 * spellings, the nesting and the digits are the response's own, because a
 * fixture written in the shape we expected is how the whole ledger came to be
 * a field the page declined to show.
 */
const ZERO = {
    'lens': 'zord',
    'rulesets': {
      'zord': {
        'max_supply': '21000000000000000000000000',
        'mint_limit': '1000000000000000000000',
        'minted': '21000000000000000000000000',
        'burned': '0',
        'shielded': '6000000000000000000000',
        'circulating': '20994000000000000000000000',
        'mint_count': '21120',
        'holders': '2330',
        'mint_progress': {
          'minted': '21000000000000000000000000',
          'max_supply': '21000000000000000000000000'
        },
        'status': 'minted'
      },
      'zecscriptions': {
        'max_supply': '21000000000000000000000000',
        'mint_limit': '1000000000000000000000',
        'minted': '21000000000000000000000000',
        'burned': '0',
        'shielded': '6000000000000000000000',
        'circulating': '20994000000000000000000000',
        'mint_count': '21000',
        'holders': '2539',
        'mint_progress': {
          'minted': '21000000000000000000000000',
          'max_supply': '21000000000000000000000000'
        },
        'status': 'minted'
      }
    },
    'tick': 'ZERO',
    'tick_key': '7a65726f',
    'decimals': '18',
    'deploy_inscription_id': '6d3a32c5a6847b14d9e361ad4384b0e0e1bf82b5b2a2ce5dc204ddf34e34ceeei0',
    'deploy_txid': '6d3a32c5a6847b14d9e361ad4384b0e0e1bf82b5b2a2ce5dc204ddf34e34ceee',
    'deploy_height': '3133112',
    'deployer_address': 't1HzoKn3UXD8vjsS2GzvjGxVUSTKa5NpeH9',
    'divergence': {
      'diverges': true,
      'fields': [
        'mint_count',
        'holders'
      ],
      'absent_from': [],
      'unevaluated': [
        {
          'id': 'zecscriptions-protocol-v2-reveal-outputs',
          'summary': 'zecscriptions protocol version 2 requires three reveal outputs: the minter at vout 0, a deployer share of 19200 zatoshis at vout 1, and a platform share of 172800 zatoshis at vout 2.',
          'reason': 'No activation height for protocol version 2 is recorded in the compatibility matrix, so applying the rule would require inventing one. Neither ruleset evaluates it.'
        },
        {
          'id': 'shielded-settlement-accounting',
          'summary': 'A settlement spend into a fully shielded transaction is a permanent burn in zord accounting.',
          'reason': 'Reported as its own bucket rather than as a ruleset switch. Shielded and burned totals are published separately so either accounting can be derived exactly.'
        }
      ]
    }
  };

describe('an asset reported under two readings of the rules', () => {
  it('shifts a quantity by the token decimals and never shifts a count', () => {
    const reading = readRulesetAsset(ZERO, 'zord');
    const figure = (key) => reading?.figures.find((f) => f.key === key);

    // 21000000000000000000000000 with 18 decimals is twenty-one million.
    // Unshifted it reads as twenty-one septillion, which is what the page
    // showed before this, inside a JSON string.
    expect(figure('max_supply')?.readings[0].amount).toEqual({
      display: '21,000,000',
      exact: '21000000000000000000000000',
    });
    expect(figure('mint_limit')?.readings[0].amount?.display).toBe('1,000');
    expect(figure('circulating')?.readings[0].amount?.display).toBe('20,994,000');
    expect(figure('shielded')?.readings[0].amount?.display).toBe('6,000');

    // Counts are things, not quantities. 2330 holders is 2330 holders.
    expect(figure('holders')?.readings[0].amount).toEqual({ display: '2,330', exact: '2330' });
    expect(figure('mint_count')?.readings[0].amount?.display).toBe('21,120');
  });

  it('keeps the exact source digits beside every rendered figure', () => {
    const reading = readRulesetAsset(ZERO, 'zord');
    for (const figure of reading?.figures ?? []) {
      for (const value of figure.readings) {
        if (value.amount) {
          expect(value.amount.exact).toMatch(/^(0|[1-9][0-9]*)$/);
        }
      }
    }
  });

  it('states the decimals once rather than per figure', () => {
    const reading = readRulesetAsset(ZERO, 'zord');
    expect(reading?.decimals).toBe(18);
    expect(reading?.decimalsExact).toBe('18');
  });

  it('puts the lens reading first and keeps the other beside it', () => {
    expect(readRulesetAsset(ZERO, 'zord')?.rulesets).toEqual(['zord', 'zecscriptions']);
    // The order follows the lens, not the object key order.
    expect(readRulesetAsset(ZERO, 'zecscriptions')?.rulesets).toEqual([
      'zecscriptions',
      'zord',
    ]);
  });

  it('shows both figures where the readings disagree, and does not pick one', () => {
    const reading = readRulesetAsset(ZERO, 'zord');
    const holders = reading?.figures.find((f) => f.key === 'holders');
    expect(holders?.diverges).toBe(true);
    expect(holders?.readings.map((r) => [r.ruleset, r.amount?.display])).toEqual([
      ['zord', '2,330'],
      ['zecscriptions', '2,539'],
    ]);
  });

  it('observes divergence from the figures rather than trusting the summary', () => {
    const reading = readRulesetAsset(ZERO, 'zord');
    // What the figures actually show, and what the authority says they show.
    // Kept apart on purpose: a summary that drifts from the data behind it is
    // the thing this product exists not to repeat.
    expect(reading?.divergingFields).toEqual(['mint_count', 'holders']);
    expect(reading?.statedDivergingFields).toEqual(['mint_count', 'holders']);
  });

  it('agrees on every quantity, which is the story worth telling', () => {
    const reading = readRulesetAsset(ZERO, 'zord');
    const amounts = reading?.figures.filter((f) => f.kind === 'amount') ?? [];
    expect(amounts.length).toBeGreaterThan(0);
    expect(amounts.every((f) => !f.diverges)).toBe(true);
  });

  it('carries the prose about rules neither reading evaluates', () => {
    const reading = readRulesetAsset(ZERO, 'zord');
    expect(reading?.unevaluated).toHaveLength(2);
    expect(reading?.unevaluated[0].reason).toContain('would require inventing one');
    expect(reading?.unevaluated[1].summary).toContain('permanent burn');
  });

  it('names a ruleset field it has no kind for rather than dropping it', () => {
    const withNewField = {
      ...ZERO,
      rulesets: {
        zord: { ...ZERO.rulesets.zord, reorg_depth: '7' },
        zecscriptions: ZERO.rulesets.zecscriptions,
      },
    };
    const reading = readRulesetAsset(withNewField, 'zord');
    expect(reading?.unreadFields).toEqual(['reorg_depth']);
    expect(reading?.figures.some((f) => f.key === 'reorg_depth')).toBe(false);
  });

  it('does not report a restated field as one it cannot read', () => {
    // mint_progress repeats minted and max_supply, both already figures.
    const reading = readRulesetAsset(ZERO, 'zord');
    expect(reading?.unreadFields).toEqual([]);
    expect(reading?.figures.some((f) => f.key === 'mint_progress')).toBe(false);
  });

  it('shows no amount at all rather than an unshifted one when decimals are unreadable', () => {
    const noDecimals = { ...ZERO, decimals: 'eighteen' };
    const reading = readRulesetAsset(noDecimals, 'zord');
    expect(reading?.decimals).toBeNull();
    const supply = reading?.figures.find((f) => f.key === 'max_supply');
    expect(supply?.readings[0].amount).toBeNull();
    // A count needs no decimals and is unaffected.
    expect(reading?.figures.find((f) => f.key === 'holders')?.readings[0].amount?.display).toBe('2,330');
  });

  it('is not this reading at all when there are no rulesets', () => {
    expect(readRulesetAsset({ tick: 'ZERO' }, 'zord')).toBeNull();
    expect(readRulesetAsset({ tick: 'ZERO', rulesets: {} }, 'zord')).toBeNull();
    expect(readRulesetAsset(null, 'zord')).toBeNull();
  });
});

describe('readDecimals', () => {
  it('refuses anything that is not a plain non-negative integer', () => {
    expect(readDecimals('18')).toBe(18);
    expect(readDecimals('0')).toBe(0);
    expect(readDecimals('018')).toBeNull();
    expect(readDecimals('-1')).toBeNull();
    expect(readDecimals('18.0')).toBeNull();
    expect(readDecimals(18)).toBeNull();
    expect(readDecimals('99')).toBeNull();
    expect(readDecimals(null)).toBeNull();
  });
});

describe('a page of assets each carrying its own ledger', () => {
  const page = {
    lens: 'zord',
    rulesets: ['zord', 'zecscriptions'],
    total: '159',
    limit: '50',
    offset: '0',
    items: [ZERO, { ...ZERO, tick: 'CALM', divergence: { diverges: false, fields: [], absent_from: [], unevaluated: [] } }],
  };

  it('reads every item and keeps the authority total exactly', () => {
    const list = readRulesetAssetList(page);
    expect(list?.shownCount).toBe(2);
    expect(list?.totalExact).toBe('159');
    expect(list?.lens).toBe('zord');
    expect(list?.rulesets).toEqual(['zord', 'zecscriptions']);
  });

  it('shows the chosen columns and names every figure it is holding back', () => {
    const list = readRulesetAssetList(page);
    expect(list?.columns.map((column) => column.key)).toEqual([
      'status', 'minted', 'max_supply', 'holders',
    ]);
    // Nine figures in the ledger, four columns on the page. The other five
    // are named, because a table that quietly shows four of nine reads as
    // the whole ledger.
    expect(list?.hiddenFigureFields).toEqual([
      'max_supply', 'mint_limit', 'minted', 'burned', 'shielded',
      'circulating', 'mint_count', 'holders', 'status',
    ].filter((key) => !['status', 'minted', 'max_supply', 'holders'].includes(key)));
  });

  it('never shifts a count column and always shifts an amount column', () => {
    const list = readRulesetAssetList(page);
    const row = list?.rows[0];
    const cell = (key) => row?.cells.find((entry) => entry.key === key);
    expect(cell('minted')?.figure?.readings[0].amount?.display).toBe('21,000,000');
    expect(cell('holders')?.figure?.readings[0].amount?.display).toBe('2,330');
    expect(cell('status')?.figure?.readings[0].word).toBe('minted');
  });

  it('marks the row whose readings disagree, from the figures themselves', () => {
    const list = readRulesetAssetList(page);
    expect(list?.rows[0].diverges).toBe(true);
    // The second row restates ZERO's figures, which still disagree on
    // holders and mint_count. Divergence is observed from the figures, not
    // from the summary object, so a summary claiming agreement cannot hide
    // a ledger that does not agree.
    expect(list?.rows[1].diverges).toBe(true);
  });

  it('counts an item it cannot read rather than dropping it in silence', () => {
    const list = readRulesetAssetList({ ...page, items: [ZERO, { tick: 'BARE' }] });
    expect(list?.shownCount).toBe(1);
    expect(list?.unreadRowCount).toBe(1);
  });

  it('is not this reading at all for a page without ruleset items', () => {
    expect(readRulesetAssetList({ items: [{ tick: 'BARE' }] })).toBeNull();
    expect(readRulesetAssetList({ items: [] })).toBeNull();
    expect(readRulesetAssetList({ transactions: [ZERO] })).toBeNull();
    expect(readRulesetAssetList(null)).toBeNull();
  });
});
