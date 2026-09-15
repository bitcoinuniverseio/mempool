import {
  WorkbenchCoreReader,
  ownedWorkbenchCore,
} from '../workbench/workbench-core';
import { InputEvidence } from './proposal-analysis';

const GENESIS: Record<string, string> = {
  mainnet: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  signet: '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',
  testnet: '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943',
  testnet4: '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',
  regtest: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
};
let active = 0;
export async function verifyProposalUtxos(
  inputs: InputEvidence[],
  core: WorkbenchCoreReader = ownedWorkbenchCore
) {
  if (!inputs.length || inputs.length > 100 || active >= 2)
    throw new Error(
      'Owned UTXO verification count or concurrency bound exceeded.'
    );
  active++;
  const operation = (async () => {
    if (
      !GENESIS[core.network] ||
      (await core.call('getblockhash', [0])) !== GENESIS[core.network]
    )
      throw new Error('Owned source network mismatch.');
    const tip = await core.call('getbestblockhash', []);
    if (typeof tip !== 'string' || !/^[0-9a-f]{64}$/.test(tip))
      throw new Error('Invalid owned checkpoint.');
    const outputs: Array<{
      outpoint: string;
      matches: boolean;
      confirmations: number | null;
      reason: string | null;
    }> = [];
    const deadline = Date.now() + 12000;
    for (const input of inputs) {
      if (Date.now() > deadline)
        throw new Error('Owned UTXO verification deadline exceeded.');
      const [txid, vout] = input.outpoint.split(':');
      const output = await core.call('gettxout', [txid, Number(vout), true]);
      if (output === null) {
        outputs.push({
          outpoint: input.outpoint,
          matches: false,
          confirmations: null,
          reason:
            'Not present in the owned UTXO view, including mempool spends.',
        });
        continue;
      }
      if (
        !output ||
        output.bestblock !== tip ||
        !Number.isSafeInteger(output.confirmations) ||
        output.confirmations < 0 ||
        typeof output.value !== 'number' ||
        !output.scriptPubKey ||
        typeof output.scriptPubKey.hex !== 'string'
      )
        throw new Error('Invalid or changed owned UTXO evidence.');
      const value = Math.round(output.value * 1e8);
      if (
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > 2100000000000000 ||
        Number((value / 1e8).toFixed(8)) !== output.value
      )
        throw new Error('Owned UTXO amount is invalid.');
      const matches =
        value === input.value &&
        output.scriptPubKey.hex === input.script &&
        !(output.coinbase && output.confirmations < 100);
      outputs.push({
        outpoint: input.outpoint,
        matches,
        confirmations: output.confirmations,
        reason: matches
          ? null
          : 'Supplied UTXO differs from the owned source or is an immature coinbase.',
      });
    }
    if ((await core.call('getbestblockhash', [])) !== tip)
      throw new Error('Owned chain tip changed; repeat validation.');
    return {
      verified: outputs.every((output) => output.matches),
      network: core.network,
      tip,
      observed_at: new Date().toISOString(),
      outputs,
    };
  })();
  // Capacity is released when the underlying RPC work actually settles, even
  // if the caller's bounded wait has already expired.
  void operation.then(
    () => {
      active--;
    },
    () => {
      active--;
    }
  );
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Owned UTXO read timed out.')),
          15000
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
