import { describe, expect, it } from 'vitest';
import { parsePortfolioAssetKey, portfolioAssetKey, PortfolioAssetIdentity } from './universe-portfolio-v2.types';

const identity = (assetId: string): PortfolioAssetIdentity => ({chain:'bitcoin', network:'signet', protocol:'op-names', assetType:'name', assetId});

describe('bounded portfolio asset identity round trip', () => {
  it('preserves long Unicode and colon-bearing identifiers without changing chain or network', () => {
    const original = identity('é:' + 'n'.repeat(356));
    const key = portfolioAssetKey(original);
    expect(key).not.toBeNull();
    expect(parsePortfolioAssetKey(key!)).toEqual(original);
  });

  it('accepts the bounded 512-character identity and rejects oversized serialized input in both directions', () => {
    const boundary = identity('n'.repeat(512));
    expect(parsePortfolioAssetKey(portfolioAssetKey(boundary)!)).toEqual(boundary);
    expect(portfolioAssetKey(identity('n'.repeat(513)))).toBeNull();
    expect(parsePortfolioAssetKey('bitcoin:signet:op-names:name:' + 'n'.repeat(513))).toBeNull();
  });
});
