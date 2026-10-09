import { bitcoinObservationMatches } from '../api/bitcoin/bitcoin-source-observation';

const now = Date.parse('2026-10-09T05:00:00Z');
const hash = 'a'.repeat(64);
const observation = { chain: 'main', blocks: 10, headers: 10, initialBlockDownload: false,
  verificationProgress: 1, checkedAt: new Date(now).toISOString(), blockHash: hash };
const tip = { height: 10, hash };

test.each([['mainnet', 'main'], ['testnet', 'test'], ['testnet4', 'testnet4'], ['signet', 'signet'], ['regtest', 'regtest']])(
  'matches the actual %s Core network, checkpoint and Signet challenge', (network, chain) => {
    expect(bitcoinObservationMatches({ ...observation, chain, signetChallenge: '51' }, network, tip, 120_000, now, '51')).toBe(true);
  });

test('rejects source conflicts, IBD, header lag, old/missing evidence and a different Signet challenge', () => {
  for (const change of [{ chain: 'signet' }, { initialBlockDownload: true }, { headers: 11 }, { blocks: 9 },
    { blockHash: 'b'.repeat(64) }, { checkedAt: new Date(now - 120_000).toISOString() }, { checkedAt: 'invalid' },
    { checkedAt: new Date(now + 1).toISOString() }]) {
    expect(bitcoinObservationMatches({ ...observation, ...change }, 'mainnet', tip, 120_000, now)).toBe(false);
  }
  expect(bitcoinObservationMatches(null, 'mainnet', tip, 120_000, now)).toBe(false);
  expect(bitcoinObservationMatches({ ...observation, chain: 'signet', signetChallenge: '52' }, 'signet', tip, 120_000, now, '51')).toBe(false);
  expect(bitcoinObservationMatches({ ...observation, chain: 'signet', signetChallenge: '51' }, 'signet', tip, 120_000, now, '')).toBe(false);
});
