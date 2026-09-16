import {
  ownedWorkbenchCore,
  WorkbenchCoreReader,
} from '../workbench/workbench-core';

const GENESIS: Record<string, string> = {
  mainnet: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  signet: '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',
  testnet: '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943',
  testnet4: '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',
  regtest: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
};
const integer = (n: unknown): n is number =>
  Number.isSafeInteger(n) && Number(n) >= 0;
const hash = (s: unknown): s is string =>
  typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
const progress = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;

/** Read-only, one in-flight observation per reader. Timeout does not free a still-running RPC slot. */
export class BootstrapNodeReader {
  private flight?: ReturnType<BootstrapNodeReader['observe']>;
  constructor(private core: WorkbenchCoreReader = ownedWorkbenchCore) {}
  async read() {
    if (!this.flight) {
      this.flight = this.observe().finally(() => {
        this.flight = undefined;
      });
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.flight,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(Error('Owned bootstrap observation timed out.')),
            10000
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
  private async observe() {
    const core = this.core,
      network = core.network;
    if (
      !GENESIS[network] ||
      (await core.call('getblockhash', [0])) !== GENESIS[network]
    )
      throw Error('Owned node genesis does not match selected network.');
    const [info, node, states, help] = await Promise.all([
      core.call('getblockchaininfo', []),
      core.call('getnetworkinfo', []),
      core.call('getchainstates', []),
      core.call('help', []),
    ]);
    const expectedChain =
      network === 'mainnet' ? 'main' : network === 'testnet' ? 'test' : network;
    if (
      info?.chain !== expectedChain ||
      !integer(info.blocks) ||
      !integer(info.headers) ||
      info.headers < info.blocks ||
      !hash(info.bestblockhash) ||
      typeof info.initialblockdownload !== 'boolean' ||
      !integer(info.size_on_disk)
    )
      throw Error('Malformed or mismatched owned blockchain observation.');
    if (
      !integer(node?.version) ||
      typeof node.subversion !== 'string' ||
      node.subversion.length > 200 ||
      typeof help !== 'string' ||
      help.length > 200000
    )
      throw Error('Malformed owned node capability observation.');
    if (
      !Array.isArray(states?.chainstates) ||
      !states.chainstates.length ||
      states.chainstates.length > 2 ||
      !integer(states.headers) ||
      states.headers !== info.headers
    )
      throw Error('Malformed or changing chainstate observation.');
    for (const state of states.chainstates) {
      if (
        !integer(state.blocks) ||
        !hash(state.bestblockhash) ||
        !progress(state.verificationprogress) ||
        typeof state.validated !== 'boolean' ||
        !integer(state.coins_db_cache_bytes) ||
        !integer(state.coins_tip_cache_bytes) ||
        (state.snapshot_blockhash !== undefined &&
          !hash(state.snapshot_blockhash))
      )
        throw Error('Malformed owned chainstate.');
    }
    const active = states.chainstates[states.chainstates.length - 1],
      background =
        states.chainstates.length === 2 ? states.chainstates[0] : undefined;
    if (
      active.blocks !== info.blocks ||
      active.bestblockhash !== info.bestblockhash ||
      (background &&
        (background.snapshot_blockhash ||
          !active.snapshot_blockhash ||
          background.blocks > active.blocks))
    )
      throw Error('Inconsistent active/background chainstates.');
    let snapshotHeight: number | undefined;
    if (active.snapshot_blockhash) {
      const header = await core.call('getblockheader', [
        active.snapshot_blockhash,
        true,
      ]);
      if (
        header?.hash !== active.snapshot_blockhash ||
        !integer(header.height) ||
        header.height > active.blocks ||
        !integer(header.confirmations) ||
        header.confirmations < 1 ||
        (await core.call('getblockhash', [header.height])) !== header.hash
      )
        throw Error('Snapshot base is not on the active owned chain.');
      snapshotHeight = header.height;
    }
    if ((await core.call('getbestblockhash', [])) !== info.bestblockhash)
      throw Error('Owned node tip changed during bootstrap observation.');
    const phase = background
      ? 'background_validation'
      : active.snapshot_blockhash
        ? active.validated
          ? 'snapshot_validated_pending_cleanup'
          : info.initialblockdownload
            ? 'snapshot_active_syncing_to_tip'
            : 'snapshot_at_tip'
        : info.initialblockdownload
          ? 'traditional_ibd'
          : active.validated
            ? 'fully_validated'
            : 'unknown';
    const observed = new Date().toISOString(),
      id = 'owned-core-' + network;
    const supports = (method: string) =>
      help
        .split('\n')
        .some((line) => line === method || line.startsWith(method + ' '));
    const capability = {
      node_id: id,
      node_software: 'Bitcoin Core RPC',
      exact_version: node.subversion,
      network,
      supports_dumptxoutset: supports('dumptxoutset'),
      supports_loadtxoutset: supports('loadtxoutset'),
      supports_getchainstates: true,
      compiled_assumeutxo_heights: null,
      compiled_assumeutxo_status: 'not_exposed_by_rpc',
      current_phase: phase,
      last_probe_at: observed,
    };
    const observation = {
      node_id: id,
      client_version: node.subversion,
      network,
      active_chainstate: {
        type: active.snapshot_blockhash ? 'snapshot' : 'ibd',
        height: active.blocks,
        best_block_hash: active.bestblockhash,
        progress: active.verificationprogress,
        validated: active.validated,
      },
      ...(background
        ? {
            background_chainstate: {
              height: background.blocks,
              best_block_hash: background.bestblockhash,
              progress: background.verificationprogress,
              target_height: snapshotHeight,
            },
          }
        : {}),
      current_phase: phase,
      coins_cache_size_mb:
        (active.coins_db_cache_bytes + active.coins_tip_cache_bytes) / 1048576,
      disk_used_gb: info.size_on_disk / 1073741824,
      disk_scope:
        'Core reported block and undo data; excludes chainstate/indexes',
      estimated_remaining_blocks: Math.max(0, info.headers - active.blocks),
      observed_at: observed,
      dual_chainstate_active: !!background,
      background_ibd_height: background?.blocks ?? null,
      snapshot_chainstate_height: active.snapshot_blockhash
        ? active.blocks
        : null,
      tip_height: active.blocks,
      sync_percent:
        100 * (background?.verificationprogress ?? active.verificationprogress),
      estimated_time_to_validation_completion_sec: null,
      source: {
        network,
        genesis_hash: GENESIS[network],
        block_hash: info.bestblockhash,
        observed_at: observed,
      },
    };
    return { capability, observation };
  }
}
