import { describe, expect, it } from 'vitest';
import { checkedDiscoveryIdentity, discoveryIdentityKey, discoveryProfile } from './discovery-source-identity';
const profile = { releaseSha: '1'.repeat(40), configurationSha256: '2'.repeat(64), genesisHash: '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6', signetChallenge: '51' };
const identity = { schema: 'universe-chain-source-identity-v1', chain: 'bitcoin', network: 'signet', ...profile,
  checkpoint: { heightAtomic: '123', blockHash: 'a'.repeat(64) }, observedAt: '2026-10-04T00:00:00Z' };
describe('operator-bound discovery identity', () => {
  it('fails closed without a bounded exact operator profile', () => {
    for (const raw of [{}, 'not json', ' '.repeat(8193), { signet: { ...profile, secret: 'unexpected' } }, { signet: { ...profile, genesisHash: 'f'.repeat(64) } }, { signet: { ...profile, signetChallenge: null } }]) {
      expect(() => discoveryProfile(raw, 'signet')).toThrow('profile');
    }
    expect(discoveryProfile(JSON.stringify({ signet: profile }), 'signet')).toEqual(profile);
  });
  it('rejects a mismatched genesis, challenge, config, artifact, network or malformed checkpoint before reads', () => {
    expect(checkedDiscoveryIdentity(identity, 'signet', profile).checkpoint.heightAtomic).toBe('123');
    for (const mutate of [v => v.genesisHash = 'b'.repeat(64), v => v.signetChallenge = '52', v => v.configurationSha256 = 'c'.repeat(64),
      v => v.releaseSha = 'd'.repeat(40), v => v.network = 'testnet', v => v.checkpoint.heightAtomic = '0123', v => v.checkpoint.heightAtomic = '9007199254740992']) {
      const value = structuredClone(identity); mutate(value); expect(() => checkedDiscoveryIdentity(value, 'signet', profile)).toThrow('does not match');
    }
  });
  it('compares complete persisted context while allowing refreshed observation timestamps', () => {
    const value = checkedDiscoveryIdentity(identity, 'signet', profile);
    expect(discoveryIdentityKey({ ...value, observedAt: '2026-10-04T00:01:00Z' })).toBe(discoveryIdentityKey(value));
    expect(discoveryIdentityKey({ ...value, checkpoint: { ...value.checkpoint, blockHash: 'b'.repeat(64) } })).not.toBe(discoveryIdentityKey(value));
  });
});
