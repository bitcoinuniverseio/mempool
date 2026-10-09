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
/**
 * IMPLEMENTATION-HANDOFF [API-01] [API-01-CANCEL]
 * DEF-CANCEL; C-HTTP-FEES, C-HTTP-ADDRESS, C-INFRA-BACKEND. Preparation only.
 * Base 81ab0f152: readCore starts promises while Promise.all's array is built.
 * A synchronous readIndex throw prevents handlers attaching; finally abort can
 * orphan Core rejections and terminate the backend. The 8s caller cancellation
 * is also disconnected from this 15s verification budget. Prior strict-mode
 * reproduction and live EABORTED/restart evidence are in the SERVER handoff.
 * 1. Reuse the inspected local repair 87859cf9f69e4166bdd783a4472c6674a2ef24c3,
 *    not a second rewrite: add optional caller AbortSignal, link it once to
 *    controller, reject an already-aborted caller before enqueuing RPC work.
 * 2. Defer each of the four independent reads through Promise.resolve().then,
 *    so Promise.all owns all failures before any read callback can throw.
 * 3. Remove the caller abort listener in finally; preserve the shared deadline,
 *    two stable-tip attempts, network/genesis/challenge/fork checks, RPC limits.
 * 4. Update both verifyAddressSource calls in address-index.ts with the caller
 *    signal, and retain caller-cancel, fresh-retry, sync-throw and fork tests.
 * Source: Node24 process unhandledRejection semantics; owned Core31 chain
 * identity; exact candidate diff and prior 44-test receipt in this handoff.
 * Verify: backend Jest address-source-checkpoint, address-index, address-
 * capabilities, bitcoin-rpc and capabilities-timeout suites (exact inventory
 * in VERIFICATION.md); tsc -p tsconfig.build.json --noEmit. Replay strict
 * cancellation in isolation. Then observe a coherent candidate without fatal
 * EABORTED through repeated optional probes and mempool synchronization.
 * Dependency: first. API-02/03/05 consume its stable backend. Do not suppress
 * uncaught failures, force readiness, enlarge RPC budgets, or restart producers.
 * Rollback: previous coherent backend artifact and existing read-only bindings;
 * no database/schema migration. Local test PASS is not public release evidence.
 */
/** Compare the selected index itself to the owned node, at one stable active checkpoint. */
/** @asyncUnsafe */
export async function verifyAddressSource(
  indexedTip: number | null,
  readHash: (height: number, signal?: AbortSignal) => Promise<unknown>,
  core = addressBitcoinClient,
  budgetMs = 15000,
): Promise<AddressSourceCheckpoint> {
  if (!Number.isSafeInteger(indexedTip) || indexedTip! < 0) throw new Error('Invalid indexed height');
  const networks = {mainnet:'main',testnet:'test',testnet4:'testnet4',signet:'signet',regtest:'regtest',liquid:'liquidv1',liquidtestnet:'liquidtestnet'};
  const controller = new AbortController();
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
      readCore('getblockhash', [0]), readCore('getblockhash', [height]),
      readIndex(0), readIndex(height),
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
  } finally { clearTimeout(timer!); controller.abort(); }
}
