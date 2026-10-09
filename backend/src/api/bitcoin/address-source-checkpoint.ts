import config from '../../config';
import { addressBitcoinClient } from './bitcoin-client';
export interface AddressSourceCheckpoint {
  genesisHash: string;
  blockHeight: number;
  blockHash: string;
  network: string;
  signetChallenge: string | null;
  verifiedAt: string;
}
const isHash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
/** Compare the selected index itself to the owned node, at one stable active checkpoint. */
/** @asyncUnsafe */
export async function verifyAddressSource(
  indexedTip: number | null,
  readHash: (height: number, signal?: AbortSignal) => Promise<unknown>,
  core = addressBitcoinClient,
  budgetMs = 15000,
  signal?: AbortSignal,
): Promise<AddressSourceCheckpoint> {
  if (!Number.isSafeInteger(indexedTip) || indexedTip! < 0) throw new Error('Invalid indexed height');
  const networks = {mainnet:'main',testnet:'test',testnet4:'testnet4',signet:'signet',regtest:'regtest',liquid:'liquidv1',liquidtestnet:'liquidtestnet'};
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, {once: true});
  let timer: ReturnType<typeof setTimeout>;
  const ensureActive = (): void => {
    if (controller.signal.aborted) throw new Error('Address source verification exceeded its deadline');
  };
  const readCore = (method: string, params: unknown[]) => {
    ensureActive();
    return core.rpc?.call
      ? core.rpc.call(method, params, {signal: controller.signal})
      : method === 'getblockchaininfo' ? core.getBlockchainInfo() : core.getBlockHash(params[0]);
  };
  const readIndex = (height: number) => { ensureActive(); return readHash(height, controller.signal); };
  const verify = /** @asyncUnsafe */ async (): Promise<AddressSourceCheckpoint> => {  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await readCore('getblockchaininfo', []);
    if (before.chain !== networks[config.MEMPOOL.NETWORK] || !Number.isSafeInteger(before.blocks) || before.blocks < 0 || !isHash(before.bestblockhash)) throw new Error('Owned node network checkpoint is invalid');
    if (indexedTip! > before.blocks + 2) throw new Error('Index is implausibly ahead of the owned node');
    const challenge = before.signet_challenge ?? null;
    if (config.MEMPOOL.NETWORK === 'signet' && (!process.env.UNIVERSE_SIGNET_CHALLENGE || challenge !== process.env.UNIVERSE_SIGNET_CHALLENGE)) throw new Error('Configured Signet challenge is not attested by the owned node');
    const height = Math.min(indexedTip!, before.blocks);
    if (config.MEMPOOL.NETWORK === 'signet' && height < 1) throw new Error('Signet identity requires a non-genesis checkpoint');
    // These four independent reads share the existing deadline; the subsequent
    // Core observation still fences every response against active-tip movement.
    const [genesis, expected, sourceGenesis, observed] = await Promise.all([
      Promise.resolve().then(() => readCore('getblockhash', [0])),
      Promise.resolve().then(() => readCore('getblockhash', [height])),
      Promise.resolve().then(() => readIndex(0)),
      Promise.resolve().then(() => readIndex(height)),
    ]);
    const after = await readCore('getblockchaininfo', []);
    if (after.chain !== before.chain || after.signet_challenge !== before.signet_challenge || after.bestblockhash !== before.bestblockhash || after.blocks !== before.blocks) continue;
    if (!isHash(genesis) || !isHash(expected) || sourceGenesis !== genesis || observed !== expected) throw new Error('Address source differs from the owned active chain');
    return {genesisHash:genesis,blockHeight:height,blockHash:expected,network:config.MEMPOOL.NETWORK,signetChallenge:challenge,verifiedAt:new Date().toISOString()};
  }
  throw new Error('Owned checkpoint moved during address source verification');
  };
  try {
    return await Promise.race([verify(), new Promise<AddressSourceCheckpoint>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Address source verification exceeded its deadline')); }, budgetMs);
    })]);
  } finally {
    clearTimeout(timer!);
    signal?.removeEventListener('abort', cancel);
    controller.abort();
  }
}
