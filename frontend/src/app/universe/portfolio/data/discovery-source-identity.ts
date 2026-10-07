export interface DiscoverySourceProfile {
  releaseSha: string; configurationSha256: string; genesisHash: string; signetChallenge: string | null;
}
export interface DiscoverySourceIdentity extends DiscoverySourceProfile {
  schema: 'universe-chain-source-identity-v1'; chain: 'bitcoin'; network: string;
  checkpoint: { heightAtomic: string; blockHash: string }; observedAt: string;
}
const genesis: Record<string, string> = {
  mainnet: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  testnet: '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943',
  signet: '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',
  testnet4: '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',
};
const hash = (value: unknown, length = 64): boolean => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);

/** Operator bootstrap expectations, never learned from the first API response. */
export function discoveryProfile(raw: unknown, network: string): DiscoverySourceProfile {
  try {
    if (typeof raw === 'string') { if (raw.length > 8192) throw Error(); raw = JSON.parse(raw); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || JSON.stringify(raw).length > 8192 || Object.keys(raw).length > 4 || Object.keys(raw).some(key => !genesis[key])) throw Error();
    const profile = raw[network] as DiscoverySourceProfile;
    if (!profile || typeof profile !== 'object' || Array.isArray(profile) || Object.keys(profile).sort().join(',') !== 'configurationSha256,genesisHash,releaseSha,signetChallenge'
      || !hash(profile.releaseSha, 40) || !hash(profile.configurationSha256) || profile.genesisHash !== genesis[network]
      || (network === 'signet' ? typeof profile.signetChallenge !== 'string' || !/^(?:[a-f0-9]{2}){1,10000}$/.test(profile.signetChallenge) : profile.signetChallenge !== null)) throw Error();
    return { ...profile };
  } catch { throw Error('Watch-only discovery source profile is not configured or is invalid for the selected network. Ask the operator to bind its verified source profile.'); }
}
export function checkedDiscoveryIdentity(raw: unknown, network: string, profile: DiscoverySourceProfile): DiscoverySourceIdentity {
  const identity = raw as DiscoverySourceIdentity;
  if (!identity || identity.schema !== 'universe-chain-source-identity-v1' || identity.chain !== 'bitcoin' || identity.network !== network
    || identity.genesisHash !== profile.genesisHash || identity.signetChallenge !== profile.signetChallenge
    || identity.releaseSha !== profile.releaseSha || identity.configurationSha256 !== profile.configurationSha256
    || !identity.checkpoint || typeof identity.checkpoint.heightAtomic !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(identity.checkpoint.heightAtomic)
    || BigInt(identity.checkpoint.heightAtomic) > BigInt(Number.MAX_SAFE_INTEGER) || !hash(identity.checkpoint.blockHash)
    || typeof identity.observedAt !== 'string' || identity.observedAt.length > 64 || !Number.isFinite(Date.parse(identity.observedAt))) {
    throw Error('The configured source identity does not match this account network and operator profile.');
  }
  return identity;
}
export function discoveryIdentityKey(identity: DiscoverySourceIdentity): string {
  return JSON.stringify([identity.network, identity.genesisHash, identity.signetChallenge, identity.releaseSha,
    identity.configurationSha256, identity.checkpoint.heightAtomic, identity.checkpoint.blockHash]);
}
