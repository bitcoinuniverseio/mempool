import axios from 'axios';
import { createHash } from 'crypto';
import { isAbsolute } from 'path';
import { constants, promises as fs, readFileSync, statSync } from 'fs';
import { LiquidObservatoryEvidenceError as EvidenceError } from './liquid-evidence-error';
import { parseLiquidRpcJson } from './liquid-native-json';

export interface LiquidPairProfile {
  schema: 'universe-liquid-pair-profile-v1';
  network: 'liquidv1' | 'liquidtestnet' | 'elementsregtest';
  parentNetwork: 'main' | 'test' | 'regtest';
  elementsGenesis: string; parentGenesis: string; policyAsset: string;
  elementsVersion: number; parentVersion: number;
  elementsSourceRevision: string; parentSourceRevision: string;
  epochLength: number; peginConfirmationDepth: number;
}
export interface LiquidNativeReader {
  call(method: string, params: unknown[], signal: AbortSignal): Promise<any>;
}
export interface LiquidPairObservation {
  profile: LiquidPairProfile; profileSha256: string; observedAt: string;
  elements: { height: number; hash: string; genesis: string; parametersRoot: string; epochLength: number; epochAge: number };
  parent: { height: number; hash: string; genesis: string };
  federation: { signblockScript: string; fedpegScript: string; fedpegProgram: string };
}
const HASH = /^[0-9a-f]{64}$/;
const SCRIPT = /^(?:[0-9a-f]{2}){1,10000}$/;
const hash = (value: unknown): value is string => typeof value === 'string' && HASH.test(value);
const script = (value: unknown): value is string => typeof value === 'string' && SCRIPT.test(value);
const METHODS = new Set(['getblockchaininfo', 'getblockhash', 'getblockheader', 'getblock', 'getnetworkinfo', 'getsidechaininfo', 'getrawtransaction', 'verifytxoutproof', 'decoderawtransaction']);
const invalid = (message: string): EvidenceError => new EvidenceError('invalid-liquid-pair', message);
const active = (signal: AbortSignal): void => { if (signal.aborted) throw new EvidenceError('liquid-source-deadline', 'The bounded Liquid observation was cancelled or exceeded its deadline.', 504); };

/** Protected credentials are never exposed by a response or error. @asyncUnsafe */
export async function readLiquidRpcCredentials(file: string, signal: AbortSignal): Promise<string> {
  active(signal);
  if (!isAbsolute(file)) throw invalid('Invalid protected native credentials.');
  const before = await fs.lstat(file);
  const protectedFile = (metadata: typeof before): boolean => metadata.isFile() && !metadata.isSymbolicLink()
    && metadata.size > 0 && metadata.size <= 4096
    && (typeof process.getuid !== 'function' || metadata.uid === process.getuid() && (metadata.mode & 0o077) === 0);
  if (!protectedFile(before) || typeof process.getuid === 'function' && !constants.O_NOFOLLOW) throw invalid('Invalid protected native credentials.');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat();
    if (!protectedFile(opened) || opened.ino !== before.ino || opened.dev !== before.dev) throw invalid('Native credential ownership changed.');
    const bytes = Buffer.alloc(4097), read = await handle.read(bytes, 0, bytes.length, 0), after = await handle.stat();
    active(signal);
    if (!protectedFile(after) || after.ino !== opened.ino || after.dev !== opened.dev
      || read.bytesRead !== after.size || read.bytesRead > 4096) throw invalid('Native credentials changed during the bounded read.');
    const credentials = bytes.subarray(0, read.bytesRead).toString('utf8').trim();
    if (!/^[^:\r\n]+:[^\r\n]+$/.test(credentials)) throw invalid('Invalid protected native credentials.');
    return credentials;
  } finally { await handle.close(); }
}

export function validateLiquidPairProfile(raw: any): LiquidPairProfile {
  if (raw?.schema !== 'universe-liquid-pair-profile-v1' || !['liquidv1', 'liquidtestnet', 'elementsregtest'].includes(raw.network)
    || !['main', 'test', 'regtest'].includes(raw.parentNetwork) || !hash(raw.elementsGenesis) || !hash(raw.parentGenesis)
    || !hash(raw.policyAsset) || typeof raw.elementsSourceRevision !== 'string' || !/^[0-9a-f]{40}$/.test(raw.elementsSourceRevision)
    || typeof raw.parentSourceRevision !== 'string' || !/^[0-9a-f]{40}$/.test(raw.parentSourceRevision)
    || !Number.isSafeInteger(raw.elementsVersion) || raw.elementsVersion <= 0 || !Number.isSafeInteger(raw.parentVersion) || raw.parentVersion <= 0
    || !Number.isSafeInteger(raw.epochLength) || raw.epochLength < 1 || raw.epochLength > 100000
    || !Number.isSafeInteger(raw.peginConfirmationDepth) || raw.peginConfirmationDepth < 1 || raw.peginConfirmationDepth > 100000
    || raw.network === 'elementsregtest' && raw.parentNetwork !== 'regtest'
    || raw.network === 'liquidv1' && raw.parentNetwork !== 'main'
    || raw.network === 'liquidtestnet' && raw.parentNetwork !== 'test') throw invalid('The operator-selected Liquid pair profile is malformed or has an incompatible parent network.');
  return { schema: raw.schema, network: raw.network, parentNetwork: raw.parentNetwork, elementsGenesis: raw.elementsGenesis,
    parentGenesis: raw.parentGenesis, policyAsset: raw.policyAsset, elementsVersion: raw.elementsVersion, parentVersion: raw.parentVersion,
    elementsSourceRevision: raw.elementsSourceRevision, parentSourceRevision: raw.parentSourceRevision,
    epochLength: raw.epochLength, peginConfirmationDepth: raw.peginConfirmationDepth };
}

export function configuredLiquidPairProfile(): LiquidPairProfile {
  const file = process.env.UNIVERSE_LIQUID_PAIR_PROFILE_FILE;
  if (!file) throw new EvidenceError('unavailable-elements-node', 'An operator-bound Elements and Bitcoin parent pair is not configured.');
  try {
    if (!isAbsolute(file) || !statSync(file).isFile() || statSync(file).size > 16384) throw invalid('Invalid operator profile file.');
    return validateLiquidPairProfile(JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) { if (error instanceof EvidenceError) throw error; throw invalid('The operator-bound Liquid profile could not be read.'); }
}

/** A narrowly read-only native transport; origins and authentication are operator configuration. */
export class LiquidRpcReader implements LiquidNativeReader {
  constructor(private kind: 'elements' | 'parent') {}
  async call(method: string, params: unknown[], signal: AbortSignal): Promise<any> {
    active(signal);
    if (!METHODS.has(method)) throw invalid('Unsupported public Liquid source method.');
    const prefix = this.kind === 'elements' ? 'UNIVERSE_ELEMENTS_RPC_' : 'UNIVERSE_LIQUID_PARENT_RPC_';
    try {
      const origin = process.env[prefix + 'ORIGIN'], cookiePath = process.env[prefix + 'COOKIE_FILE'];
      if (!origin || !cookiePath || !isAbsolute(cookiePath)) throw invalid('The exact native reader is not configured.');
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw invalid('Invalid native origin.');
      const credentials = await readLiquidRpcCredentials(cookiePath, signal);
      active(signal);
      const response = await axios.post(url.toString(), { jsonrpc: '1.0', id: 'public-liquid-evidence', method, params }, {
        signal, headers: { Authorization: 'Basic ' + Buffer.from(credentials).toString('base64') }, timeout: 5000,
        maxContentLength: 8 * 1024 * 1024, maxBodyLength: 256 * 1024, maxRedirects: 0, proxy: false,
        responseType: 'text', transformResponse: [value => value],
      });
      active(signal);
      const envelope = parseLiquidRpcJson(response.data);
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || envelope.error
        || envelope.id !== 'public-liquid-evidence' || !Object.prototype.hasOwnProperty.call(envelope, 'result')) throw invalid('The native public read failed.');
      return envelope.result;
    } catch (error) {
      active(signal);
      if (error instanceof EvidenceError) throw error;
      throw new EvidenceError('unavailable-elements-node', 'The selected native Liquid or Bitcoin parent reader is unavailable.');
    }
  }
}

export class LiquidPairedSource {
  public readonly profile: LiquidPairProfile;
  constructor(profile: LiquidPairProfile,
    public readonly elements: LiquidNativeReader = new LiquidRpcReader('elements'),
    public readonly parent: LiquidNativeReader = new LiquidRpcReader('parent')) { this.profile = Object.freeze(validateLiquidPairProfile(profile)); }
  /** Independent chain facts are fenced; heights of two different chains are never equated. @asyncUnsafe */
  async observe(signal: AbortSignal): Promise<LiquidPairObservation> {
    active(signal);
    const [elements, parent] = await Promise.all([
      this.elements.call('getblockchaininfo', [], signal), this.parent.call('getblockchaininfo', [], signal),
    ]);
    active(signal);
    for (const [info, network] of [[elements, this.profile.network], [parent, this.profile.parentNetwork]]) {
      if (info?.chain !== network || info.initialblockdownload !== false || !Number.isSafeInteger(info.blocks) || info.blocks < 0 || !hash(info.bestblockhash)) {
        throw invalid('The native pair is not ready or returned a wrong-network checkpoint.');
      }
    }
    const [elementsGenesis, parentGenesis, sidechain, elementsSoftware, parentSoftware, header] = await Promise.all([
      this.elements.call('getblockhash', [0], signal), this.parent.call('getblockhash', [0], signal),
      this.elements.call('getsidechaininfo', [], signal), this.elements.call('getnetworkinfo', [], signal),
      this.parent.call('getnetworkinfo', [], signal), this.elements.call('getblockheader', [elements.bestblockhash, true], signal),
    ]);
    active(signal);
    if (elementsGenesis !== this.profile.elementsGenesis || parentGenesis !== this.profile.parentGenesis
      || sidechain?.parent_blockhash !== parentGenesis || sidechain.pegged_asset !== this.profile.policyAsset
      || sidechain.pegin_confirmation_depth !== this.profile.peginConfirmationDepth
      || elementsSoftware?.version !== this.profile.elementsVersion || parentSoftware?.version !== this.profile.parentVersion
      || elements.epoch_length !== this.profile.epochLength || !Number.isSafeInteger(elements.epoch_age) || elements.epoch_age < 0 || elements.epoch_age >= elements.epoch_length
      || !hash(elements.current_params_root) || !script(elements.current_signblock_hex)
      || !script(elements.current_fedpeg_script) || !script(elements.current_fedpeg_program)
      || header?.hash !== elements.bestblockhash || header.height !== elements.blocks
      || header.dynamic_parameters?.current?.root !== elements.current_params_root) throw invalid('The native pair does not match its configured genesis, rules, software or federation checkpoint.');
    const [elementHash, parentHash, elementAfter, parentAfter] = await Promise.all([
      this.elements.call('getblockhash', [elements.blocks], signal), this.parent.call('getblockhash', [parent.blocks], signal),
      this.elements.call('getblockchaininfo', [], signal), this.parent.call('getblockchaininfo', [], signal),
    ]);
    active(signal);
    if (elementHash !== elements.bestblockhash || parentHash !== parent.bestblockhash
      || elementAfter?.bestblockhash !== elements.bestblockhash || parentAfter?.bestblockhash !== parent.bestblockhash
      || elementAfter.blocks !== elements.blocks || parentAfter.blocks !== parent.blocks
      || elementAfter.chain !== this.profile.network || parentAfter.chain !== this.profile.parentNetwork
      || elementAfter.initialblockdownload !== false || parentAfter.initialblockdownload !== false
      || elementAfter.current_params_root !== elements.current_params_root
      || elementAfter.epoch_length !== elements.epoch_length || elementAfter.epoch_age !== elements.epoch_age
      || elementAfter.current_signblock_hex !== elements.current_signblock_hex
      || elementAfter.current_fedpeg_script !== elements.current_fedpeg_script
      || elementAfter.current_fedpeg_program !== elements.current_fedpeg_program) {
      throw new EvidenceError('liquid-pair-changed', 'The native Liquid pair changed during observation; no projection checkpoint advanced.', 409);
    }
    return { profile: this.profile, profileSha256: createHash('sha256').update(JSON.stringify(this.profile)).digest('hex'), observedAt: new Date().toISOString(),
      elements: { height: elements.blocks, hash: elements.bestblockhash, genesis: elementsGenesis, parametersRoot: elements.current_params_root,
        epochLength: elements.epoch_length, epochAge: elements.epoch_age },
      parent: { height: parent.blocks, hash: parent.bestblockhash, genesis: parentGenesis },
      federation: { signblockScript: elements.current_signblock_hex, fedpegScript: elements.current_fedpeg_script, fedpegProgram: elements.current_fedpeg_program } };
  }
}
