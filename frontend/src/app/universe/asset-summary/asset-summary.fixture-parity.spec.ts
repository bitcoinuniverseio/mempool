import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  decodeTransactionAssetSummary,
} from '@app/universe/transaction-assets/transaction-assets.types';

/**
 * The visual-QA fixtures have to satisfy the same decoder the application uses.
 *
 * They did not, and nothing noticed. The fixture router falls back to a prefix
 * match, so a missing summary fixture was answered with the detailed flow
 * payload; the panel rejected it as the wrong schema and every transaction and
 * address screenshot reviewed the panel's error state rather than the panel.
 * A screenshot of a failure looks like a screenshot, which is why this is
 * asserted here rather than left to a reviewer's eye.
 *
 * The fixtures are ESM in the repository's script tree, outside the frontend's
 * module graph, so they are loaded by path at test time rather than imported.
 */
async function loadChainFixtures(): Promise<Record<string, unknown>> {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturesPath = resolve(
    here,
    '../../../../../scripts/universe/visual-qa/chain-fixtures.mjs',
  );
  const module = (await import(/* @vite-ignore */ fixturesPath)) as {
    chainFixtures: Record<string, unknown>;
  };
  return module.chainFixtures;
}

async function loadDetailFixtures(): Promise<Record<string, unknown>> {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturesPath = resolve(
    here,
    '../../../../../scripts/universe/visual-qa/fixtures.mjs',
  );
  const module = (await import(/* @vite-ignore */ fixturesPath)) as {
    detailFixtures: Record<string, unknown>;
  };
  return module.detailFixtures;
}

describe('visual-QA fixtures match the summary contract', () => {
  it('serves a summary fixture the decoder accepts', async () => {
    const fixtures = await loadDetailFixtures();
    const paths = Object.keys(fixtures).filter((path) => path.endsWith('/assets'));
    expect(paths.length).toBeGreaterThan(0);

    for (const path of paths) {
      const txid = path.split('/').slice(-2)[0];
      const decoded = decodeTransactionAssetSummary(fixtures[path], {
        chain: 'bitcoin',
        network: 'mainnet',
        txid,
      });
      expect(decoded.txid).toBe(txid);
      // Not conclusive on purpose: one roster protocol has no reader, so a
      // stated total would contradict its own coverage.
      expect(decoded.counts.totalCount).toBeNull();
      expect(decoded.assets.length).toBeGreaterThan(0);
      expect(decoded.assets[0].outputs.quantityAtomic).not.toBeNull();
      // The evidence the panel needs to word acceptance truthfully.
      expect(decoded.assets[0].effects[0].evidence?.authorityId).toBeTruthy();
      expect(decoded.checkpoint).not.toBeNull();
    }
  });

  it('does not let the flow payload pass as a summary', async () => {
    const fixtures = await loadDetailFixtures();
    const flowPath = Object.keys(fixtures).find(
      (path) => path.includes('/universe/transactions/') && !path.endsWith('/assets'),
    );
    expect(flowPath).toBeTruthy();
    // This is what the summary endpoint was being served, and why the panel
    // rendered an error. The decoder must keep refusing it.
    expect(() => decodeTransactionAssetSummary(fixtures[flowPath as string], {
      chain: 'bitcoin',
      network: 'mainnet',
      txid: (flowPath as string).split('/').pop() as string,
    })).toThrow();
  });
});

describe('the chain transaction fixtures match the summary contract', () => {
  it('serves a summary the decoder accepts for every chain route', async () => {
    const fixtures = await loadChainFixtures();
    const paths = Object.keys(fixtures).filter((path) => path.endsWith('/assets'));
    // Dogecoin and Zcash. Their absence is what made the panel's request fail
    // closed on those routes once the pages rendered far enough to make it.
    expect(paths).toHaveLength(2);
    for (const path of paths) {
      const txid = path.split('/').slice(-2)[0];
      const payload = fixtures[path] as { chain: string };
      const decoded = decodeTransactionAssetSummary(payload, {
        chain: payload.chain,
        network: 'mainnet',
        txid,
      });
      expect(decoded.assets).toHaveLength(1);
      expect(decoded.assets[0].outputs.quantityAtomic).not.toBeNull();
      expect(decoded.checkpoint?.heightAtomic).not.toBe('0');
      // One reader answered and the rest of the roster has none, so no total.
      if (decoded.perProtocolCoverage.length > 1) {
        expect(decoded.counts.totalCount).toBeNull();
      }
    }
  });

  it('keeps a divisibility the authority did not state unknown', async () => {
    const fixtures = await loadChainFixtures();
    const zcash = Object.entries(fixtures).find(
      ([path, value]) =>
        path.endsWith('/assets') && (value as { chain: string }).chain === 'zcash',
    );
    expect(zcash).toBeTruthy();
    const [path, payload] = zcash as [string, { chain: string }];
    const decoded = decodeTransactionAssetSummary(payload, {
      chain: 'zcash',
      network: 'mainnet',
      txid: path.split('/').slice(-2)[0],
    });
    // Null, so the panel shows the true digits labelled as smallest units.
    expect(decoded.assets[0].decimals).toBeNull();
  });
});
