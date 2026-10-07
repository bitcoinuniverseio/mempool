import { LiquidObservatoryEvidenceError as EvidenceError } from './liquid-evidence-error';
import { LiquidPairedSource, LiquidPairObservation } from './liquid-paired-source';
import { LiquidProjectionState, LiquidProjectionStore } from './liquid-projection-store';
import { LiquidVerifiedPegInput, projectLiquidPublicBlock, verifyLiquidPegInput } from './liquid-public-projection';

export interface LiquidProjectionSnapshot {
  schema: 'universe-liquid-observatory-projection-v1';
  status: 'PARTIAL' | 'COMPLETE_AT_OBSERVED_PAIR';
  observation: LiquidPairObservation; state: LiquidProjectionState;
  verifiedPegInputs: LiquidVerifiedPegInput[];
  progress: { processedBlocks: number; expectedBlocks: number; nextHeight: number; pageLimit: 16 };
}
const active = (signal: AbortSignal): void => { if (signal.aborted) throw new EvidenceError('liquid-source-deadline', 'The bounded Liquid projection acquisition was cancelled.', 504); };
const changed = (): never => { throw new EvidenceError('liquid-pair-changed', 'The selected pair changed; no projection progress was committed.', 409); };
const samePair = (a: LiquidPairObservation, b: LiquidPairObservation): boolean => a.profileSha256 === b.profileSha256
  && a.elements.hash === b.elements.hash && a.parent.hash === b.parent.hash && a.elements.height === b.elements.height
  && a.parent.height === b.parent.height && a.elements.parametersRoot === b.elements.parametersRoot;

/** Explicit manual continuation; ordinary reads never launch a historical scan. */
export class LiquidProjectionEngine {
  constructor(private source: Pick<LiquidPairedSource, 'observe' | 'elements' | 'parent'>,
    private store: Pick<LiquidProjectionStore, 'read' | 'transaction'>) {}

  private result(state: LiquidProjectionState, observation: LiquidPairObservation, verifiedPegInputs: LiquidVerifiedPegInput[]): LiquidProjectionSnapshot {
    return { schema: 'universe-liquid-observatory-projection-v1',
      status: state.blocks.length === observation.elements.height + 1 ? 'COMPLETE_AT_OBSERVED_PAIR' : 'PARTIAL',
      observation, state, verifiedPegInputs, progress: { processedBlocks: state.blocks.length, expectedBlocks: observation.elements.height + 1,
        nextHeight: state.blocks.length, pageLimit: 16 } };
  }
  /** @asyncUnsafe */
  private async parentProofs(state: LiquidProjectionState, observation: LiquidPairObservation, signal: AbortSignal): Promise<LiquidVerifiedPegInput[]> {
    const inputs = state.blocks.flatMap(block => block.pegInputs);
    // The bounded source never silently omits old parent proofs to manufacture a complete read.
    if (inputs.length > 1000) throw new EvidenceError('liquid-parent-proof-capacity', 'The selected public parent-proof set exceeds the bounded reader capacity.');
    const verified: LiquidVerifiedPegInput[] = [];
    for (let index = 0; index < inputs.length; index += 4) {
      active(signal);
      verified.push(...await Promise.all(inputs.slice(index, index + 4).map(input => verifyLiquidPegInput(input, observation, this.source.parent, signal))));
    }
    return verified;
  }
  /** @asyncUnsafe */
  async snapshot(signal: AbortSignal): Promise<LiquidProjectionSnapshot> {
    active(signal);
    const observation = await this.source.observe(signal), state = await this.store.read(signal);
    active(signal);
    if (state.profileSha256 !== observation.profileSha256) return changed();
    if (state.blocks.length) {
      const last = state.blocks[state.blocks.length - 1];
      if (last.height > observation.elements.height || await this.source.elements.call('getblockhash', [last.height], signal) !== last.hash) return changed();
      if (state.blocks[0].hash !== observation.elements.genesis) return changed();
    }
    const verified = await this.parentProofs(state, observation, signal);
    const after = await this.source.observe(signal); active(signal);
    if (!samePair(observation, after)) return changed();
    return this.result(state, after, verified);
  }
  /** Expected cursor prevents a lost-response retry from silently advancing a second page. @asyncUnsafe */
  async advance(expectedHeight: number, expectedHash: string | null, signal: AbortSignal): Promise<LiquidProjectionSnapshot> {
    if (!Number.isSafeInteger(expectedHeight) || expectedHeight < -1 || expectedHeight === -1 && expectedHash !== null
      || expectedHeight >= 0 && (typeof expectedHash !== 'string' || !/^[0-9a-f]{64}$/.test(expectedHash))) {
      throw new EvidenceError('invalid-liquid-cursor', 'An exact previously observed projection cursor is required.', 400);
    }
    let committedObservation: LiquidPairObservation | undefined;
    let verified: LiquidVerifiedPegInput[] = [];
    /** @asyncUnsafe */
    const acquire = async (prior: LiquidProjectionState): Promise<LiquidProjectionState> => {
      active(signal);
      const cursor = prior.blocks[prior.blocks.length - 1];
      if ((cursor?.height ?? -1) !== expectedHeight || (cursor?.hash ?? null) !== expectedHash) {
        throw new EvidenceError('liquid-cursor-changed', 'The durable projection cursor already changed; read its current receipt before continuing.', 409);
      }
      const before = await this.source.observe(signal); active(signal);
      if (prior.profileSha256 !== before.profileSha256) return changed();
      if (prior.blocks.length && prior.blocks[0].hash !== before.elements.genesis) return changed();
      let blocks = prior.blocks.slice();
      if (blocks.length) {
        const initialCount = blocks.length;
        while (blocks.length) {
          if (initialCount - blocks.length > 16) throw new EvidenceError('liquid-reorg-depth', 'The source reorg exceeds the explicit sixteen-block recovery bound; historical evidence remains preserved.', 409);
          const last = blocks[blocks.length - 1]; active(signal);
          if (last.height <= before.elements.height && await this.source.elements.call('getblockhash', [last.height], signal) === last.hash) break;
          blocks.pop();
        }
      }
      const end = Math.min(before.elements.height + 1, blocks.length + 16);
      let retainedBytes = Buffer.byteLength(JSON.stringify({ ...prior, blocks }));
      for (let height = blocks.length; height < end; height++) {
        active(signal);
        if (height >= 100000) throw new EvidenceError('liquid-projection-capacity', 'The selected projection reached its explicit one hundred thousand block capacity.');
        const hash = await this.source.elements.call('getblockhash', [height], signal); active(signal);
        const [header, block] = await Promise.all([this.source.elements.call('getblockheader', [hash, true], signal),
          this.source.elements.call('getblock', [hash, 2], signal)]);
        active(signal);
        const normalized = projectLiquidPublicBlock(header, block);
        if (normalized.hash !== hash || normalized.height !== height || height === 0 && hash !== before.elements.genesis
          || normalized.previousHash !== (height ? blocks[height - 1].hash : null)) return changed();
        retainedBytes += Buffer.byteLength(JSON.stringify(normalized)) + 1;
        // Leave room for the checksummed, JSON-escaped durable envelope (32MiB).
        if (retainedBytes > 24 * 1024 * 1024) throw new EvidenceError('liquid-projection-capacity', 'The public projection exceeded its explicit twenty-four MiB acquisition byte budget; no page was committed.');
        blocks.push(normalized);
      }
      const next = { ...prior, blocks, updatedAt: new Date().toISOString() };
      verified = await this.parentProofs(next, before, signal);
      const after = await this.source.observe(signal); active(signal);
      if (!samePair(before, after)) return changed();
      committedObservation = after;
      return next;
    };
    const state = await this.store.transaction(acquire, signal);
    if (!committedObservation) return changed();
    return this.result(state, committedObservation, verified);
  }
}
