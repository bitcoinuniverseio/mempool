/**
 * The only node methods the public console can reach, and what it does to
 * their answers before they leave this process.
 *
 * This is an allowlist and never anything else. There is no path here that
 * takes a method name from a request and calls it: a method absent from this
 * file is unreachable, and adding one is a change to this file that a reviewer
 * sees. A denylist would have the opposite property, where every method Core
 * adds in future is reachable until somebody remembers to forbid it.
 *
 * Two things are kept out even though they are read only.
 *
 * Anything that describes the process rather than the chain. `getrpcinfo`
 * names the log path and the commands in flight; `getmemoryinfo` describes
 * the allocator. Neither says anything about Bitcoin and both say something
 * about this host.
 *
 * Anything whose cost is unbounded. `gettxoutsetinfo` walks the whole UTXO
 * set, and a public route that can be made to do that on demand is a way to
 * stop the node.
 *
 * What does get through is trimmed. A peer's address is this node's topology,
 * not a fact about Bitcoin, and publishing it hands an attacker the list of
 * peers to go after. The useful part of a peer, which is its direction, its
 * network, its age and what it relays, survives that trimming intact.
 */

export type ParamType = 'txid' | 'blockhash' | 'height' | 'index' | 'bool' | 'count' | 'hex' | 'address' | 'enum';

export interface ParamSpec {
  readonly name: string;
  readonly type: ParamType;
  readonly required: boolean;
  readonly description: string;
  /** Upper bound for a count, so a caller cannot ask for an unbounded answer. */
  readonly max?: number;
  readonly values?: readonly string[];
}

export type Category = 'chain' | 'mempool' | 'network' | 'mining' | 'decode';

export interface AllowedMethod {
  /** The name Bitcoin Core knows it by, which is what the catalog shows. */
  readonly name: string;
  /** The method on the client, which is how it is actually called. */
  readonly clientMethod: string;
  readonly category: Category;
  readonly summary: string;
  readonly params: readonly ParamSpec[];
  /** True when the same arguments always give the same answer. */
  readonly immutable: boolean;
  /** Trims the answer before it leaves this process. */
  readonly redact?: (value: unknown) => unknown;
  /** Why this method's answer is trimmed, shown next to the result. */
  readonly redactionNote?: string;
}

const TXID = /^[0-9a-f]{64}$/i;
const HEX = /^[0-9a-f]+$/i;
// Deliberately broad. This is a shape check before a call, not an address
// validator, and the node's own answer is the authority on validity.
const ADDRESS = /^[0-9a-zA-Z]{14,110}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Removes this node's own addresses from its network description.
 *
 * `localaddresses` is where a node reports what it believes its own reachable
 * addresses are, which on a node behind a tunnel is exactly the thing the
 * tunnel exists to keep private.
 */
export function redactNetworkInfo(value: unknown): unknown {
  if (!isRecord(value)) { return value; }
  const { localaddresses, ...rest } = value;
  void localaddresses;
  return { ...rest, localaddresses: '[removed: this node own addresses]' };
}

/** Fields of a peer that describe where it is rather than what it does. */
const PEER_LOCATION_FIELDS = [
  'addr', 'addrbind', 'addrlocal', 'mapped_as', 'addr_processed', 'addr_rate_limited',
];

/**
 * Keeps what a peer does and drops where it is.
 *
 * Direction, network, age, version, service flags and relay behaviour are
 * facts about how this node is connected, and they are the reason the page
 * exists. An address is a target.
 */
export function redactPeerInfo(value: unknown): unknown {
  if (!Array.isArray(value)) { return value; }
  return value.map((peer) => {
    if (!isRecord(peer)) { return peer; }
    const kept: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(peer)) {
      if (PEER_LOCATION_FIELDS.includes(key)) { continue; }
      kept[key] = field;
    }
    return kept;
  });
}

export const ALLOWED_METHODS: readonly AllowedMethod[] = [
  {
    name: 'getblockchaininfo',
    clientMethod: 'getBlockchainInfo',
    category: 'chain',
    summary: 'The chain, the tip, how far verification has got, and whether the node is still catching up.',
    params: [],
    immutable: false,
  },
  {
    name: 'getbestblockhash',
    clientMethod: 'getBestBlockHash',
    category: 'chain',
    summary: 'The hash of the block at the tip.',
    params: [],
    immutable: false,
  },
  {
    name: 'getblockcount',
    clientMethod: 'getBlockCount',
    category: 'chain',
    summary: 'The height of the tip.',
    params: [],
    immutable: false,
  },
  {
    name: 'getblockhash',
    clientMethod: 'getBlockHash',
    category: 'chain',
    summary: 'The hash of the block at a height.',
    params: [{ name: 'height', type: 'height', required: true, description: 'Block height.' }],
    immutable: true,
  },
  {
    name: 'getblockheader',
    clientMethod: 'getBlockHeader',
    category: 'chain',
    summary: 'A block header, without the transactions in it.',
    params: [
      { name: 'blockhash', type: 'blockhash', required: true, description: 'Block hash.' },
      { name: 'verbose', type: 'bool', required: false, description: 'Decoded rather than hexadecimal.' },
    ],
    immutable: true,
  },
  {
    name: 'getblockstats',
    clientMethod: 'getBlockStats',
    category: 'chain',
    summary: 'Fee, size and transaction statistics for one block.',
    params: [{ name: 'hash_or_height', type: 'blockhash', required: true, description: 'Block hash.' }],
    immutable: true,
  },
  {
    name: 'getchaintips',
    clientMethod: 'getChainTips',
    category: 'chain',
    summary: 'Every tip this node knows of, including the ones it did not choose.',
    params: [],
    immutable: false,
  },
  {
    name: 'getchaintxstats',
    clientMethod: 'getChainTxStats',
    category: 'chain',
    summary: 'Transaction counts and rates over a window of blocks.',
    params: [{
      name: 'nblocks', type: 'count', required: false, max: 100_000,
      description: 'How many blocks to measure over.',
    }],
    immutable: false,
  },
  {
    name: 'getdifficulty',
    clientMethod: 'getDifficulty',
    category: 'chain',
    summary: 'The current proof of work difficulty.',
    params: [],
    immutable: false,
  },
  {
    name: 'gettxout',
    clientMethod: 'getTxOut',
    category: 'chain',
    summary: 'One unspent output, if it is still unspent.',
    params: [
      { name: 'txid', type: 'txid', required: true, description: 'Transaction id.' },
      { name: 'n', type: 'index', required: true, description: 'Output position.' },
      { name: 'include_mempool', type: 'bool', required: false, description: 'Count mempool spends.' },
    ],
    immutable: false,
  },
  {
    name: 'getindexinfo',
    clientMethod: 'getIndexInfo',
    category: 'chain',
    summary: 'Which optional indexes this node keeps, and how far each has got.',
    params: [],
    immutable: false,
  },
  {
    name: 'getmempoolinfo',
    clientMethod: 'getMempoolInfo',
    category: 'mempool',
    summary: 'Mempool size, limits, and the fee policy the node applies to it.',
    params: [],
    immutable: false,
  },
  {
    name: 'getmempoolentry',
    clientMethod: 'getMempoolEntry',
    category: 'mempool',
    summary: 'One mempool transaction, with its fees, size and relatives.',
    params: [{ name: 'txid', type: 'txid', required: true, description: 'Transaction id.' }],
    immutable: false,
  },
  {
    name: 'estimatesmartfee',
    clientMethod: 'estimateSmartFee',
    category: 'mempool',
    summary: 'The node own fee estimate for confirming within a number of blocks.',
    params: [{
      name: 'conf_target', type: 'count', required: true, max: 1008,
      description: 'Blocks to confirm within.',
    }],
    immutable: false,
  },
  {
    name: 'getnetworkinfo',
    clientMethod: 'getNetworkInfo',
    category: 'network',
    summary: 'Version, protocol, relay policy and which networks are reachable.',
    params: [],
    immutable: false,
    redact: redactNetworkInfo,
    redactionNote: 'The node own addresses are removed. On a node behind a tunnel they are exactly what the tunnel exists to keep private.',
  },
  {
    name: 'getpeerinfo',
    clientMethod: 'getPeerInfo',
    category: 'network',
    summary: 'Every connection, with its direction, age, version and what it relays.',
    params: [],
    immutable: false,
    redact: redactPeerInfo,
    redactionNote: 'Peer addresses are removed. They are this node topology rather than a fact about Bitcoin, and publishing them hands an attacker the list of peers to go after.',
  },
  {
    name: 'getconnectioncount',
    clientMethod: 'getConnectionCount',
    category: 'network',
    summary: 'How many peers are connected.',
    params: [],
    immutable: false,
  },
  {
    name: 'getnettotals',
    clientMethod: 'getNetTotals',
    category: 'network',
    summary: 'Bytes in and out since the node started.',
    params: [],
    immutable: false,
  },
  {
    name: 'getmininginfo',
    clientMethod: 'getMiningInfo',
    category: 'mining',
    summary: 'Difficulty, network hash rate and the size of the current template.',
    params: [],
    immutable: false,
  },
  {
    name: 'decoderawtransaction',
    clientMethod: 'decodeRawTransaction',
    category: 'decode',
    summary: 'Reads a raw transaction. Nothing is broadcast and nothing is stored.',
    params: [{ name: 'hexstring', type: 'hex', required: true, description: 'Raw transaction in hexadecimal.' }],
    immutable: true,
  },
  {
    name: 'decodescript',
    clientMethod: 'decodeScript',
    category: 'decode',
    summary: 'Reads a script and says what kind it is.',
    params: [{ name: 'hexstring', type: 'hex', required: true, description: 'Script in hexadecimal.' }],
    immutable: true,
  },
  {
    name: 'validateaddress',
    clientMethod: 'validateAddress',
    category: 'decode',
    summary: 'Says whether an address is well formed, without touching a wallet.',
    params: [{ name: 'address', type: 'address', required: true, description: 'An address.' }],
    immutable: true,
  },
];

const BY_NAME = new Map(ALLOWED_METHODS.map((method) => [method.name, method]));

/** The method, or null when it is not on the list. Never a lookup by string. */
export function methodNamed(name: unknown): AllowedMethod | null {
  if (typeof name !== 'string') { return null; }
  return BY_NAME.get(name) ?? null;
}

export interface ArgumentError {
  readonly message: string;
}

/**
 * Turns request arguments into the ones the client is called with.
 *
 * Every value is checked against the specification for its position, and
 * anything past the last declared parameter is refused rather than dropped: a
 * caller who sent a fourth argument and got a three argument call has been
 * told their request was understood when it was not.
 */
export function readArguments(
  method: AllowedMethod,
  raw: unknown,
): unknown[] | ArgumentError {
  const supplied = Array.isArray(raw) ? raw : [];
  if (!Array.isArray(raw) && raw !== undefined && raw !== null) {
    return { message: 'Arguments must be sent as an array.' };
  }
  if (supplied.length > method.params.length) {
    return {
      message: `${method.name} takes at most ${method.params.length} arguments and ${supplied.length} were sent.`,
    };
  }
  const args: unknown[] = [];
  for (let i = 0; i < method.params.length; i++) {
    const spec = method.params[i];
    const value = supplied[i];
    if (value === undefined || value === null || value === '') {
      if (spec.required) {
        return { message: `${method.name} needs ${spec.name}.` };
      }
      // A missing optional argument ends the list. Passing undefined through
      // would send a null to the node in a position it reads positionally.
      break;
    }
    const checked = checkParam(spec, value);
    if (typeof checked === 'object' && checked !== null && 'message' in checked) {
      return checked as ArgumentError;
    }
    args.push(checked);
  }
  return args;
}

function checkParam(spec: ParamSpec, value: unknown): unknown | ArgumentError {
  const text = typeof value === 'string' ? value.trim() : value;
  switch (spec.type) {
    case 'txid':
    case 'blockhash':
      if (typeof text !== 'string' || !TXID.test(text)) {
        return { message: `${spec.name} must be 64 hexadecimal characters.` };
      }
      return text.toLowerCase();
    case 'hex':
      if (typeof text !== 'string' || !HEX.test(text) || text.length % 2 !== 0) {
        return { message: `${spec.name} must be an even number of hexadecimal characters.` };
      }
      // Bounded so a request cannot become a payload. Well above any real
      // transaction and well below anything worth worrying about.
      if (text.length > 2_000_000) {
        return { message: `${spec.name} is larger than this route will send.` };
      }
      return text.toLowerCase();
    case 'address':
      if (typeof text !== 'string' || !ADDRESS.test(text)) {
        return { message: `${spec.name} is not the shape of an address.` };
      }
      return text;
    case 'height': {
      const height = Number(text);
      if (!Number.isInteger(height) || height < 0 || height > 100_000_000) {
        return { message: `${spec.name} must be a whole block height.` };
      }
      return height;
    }
    case 'index': {
      const index = Number(text);
      if (!Number.isInteger(index) || index < 0 || index > 100_000) {
        return { message: `${spec.name} must be a whole output position.` };
      }
      return index;
    }
    case 'count': {
      const count = Number(text);
      const max = spec.max ?? 1000;
      if (!Number.isInteger(count) || count < 1 || count > max) {
        return { message: `${spec.name} must be a whole number from 1 to ${max}.` };
      }
      return count;
    }
    case 'bool':
      if (text === true || text === 'true') { return true; }
      if (text === false || text === 'false') { return false; }
      return { message: `${spec.name} must be true or false.` };
    case 'enum':
      if (typeof text !== 'string' || !(spec.values ?? []).includes(text)) {
        return { message: `${spec.name} must be one of ${(spec.values ?? []).join(', ')}.` };
      }
      return text;
    default:
      return { message: `${spec.name} is of a kind this route cannot check.` };
  }
}

/**
 * Method names that must never be reachable, whatever else changes.
 *
 * Held here rather than only in a test so the intent lives next to the
 * allowlist. A build that somehow put one of these on the list fails its
 * own check rather than shipping.
 */
export const FORBIDDEN_METHODS: readonly string[] = [
  // Control over the node itself.
  'stop', 'setnetworkactive', 'addnode', 'disconnectnode', 'setban', 'clearbanned',
  'listbanned', 'invalidateblock', 'reconsiderblock', 'savemempool', 'pruneblockchain',
  'logging', 'setmocktime',
  // Mining control.
  'generatetoaddress', 'generateblock', 'generatetodescriptor', 'submitblock',
  'submitheader', 'prioritisetransaction', 'getblocktemplate',
  // Anything that touches a key or a wallet.
  'dumpprivkey', 'dumpwallet', 'importprivkey', 'importwallet', 'importdescriptors',
  'importmulti', 'loadwallet', 'unloadwallet', 'createwallet', 'encryptwallet',
  'walletpassphrase', 'signrawtransactionwithkey', 'signrawtransactionwithwallet',
  'signmessage', 'signmessagewithprivkey', 'sendtoaddress', 'sendmany', 'send',
  'walletcreatefundedpsbt', 'walletprocesspsbt', 'getbalance', 'listunspent',
  'rescanblockchain', 'backupwallet', 'getnewaddress',
  // Broadcasting, which the workbench does deliberately and this does not.
  'sendrawtransaction', 'submitpackage',
  // Describes this process rather than the chain.
  'getrpcinfo', 'getmemoryinfo', 'uptime', 'help', 'getdescriptorinfo',
  // Unbounded cost.
  'gettxoutsetinfo', 'scantxoutset', 'scanblocks', 'getrawmempool',
];

/** True when every forbidden name really is absent from the allowlist. */
export function allowlistIsClean(): boolean {
  return FORBIDDEN_METHODS.every((name) => !BY_NAME.has(name));
}
