import { buildClusters, compareFeerate, type ChunkView, type ClusterInputTx } from './cluster-engine';

/**
 * Works out what a node would do with a set of transactions, before they are
 * sent to one.
 *
 * The node itself answers the only question that really matters, through
 * `testmempoolaccept`: would this be accepted, and if not, why not. What this
 * module adds is everything that answer leaves out.
 *
 * A rejection reason is a short string. It says `insufficient fee` without
 * saying how much is missing, `txn-mempool-conflict` without saying which
 * transaction is in the way, and nothing at all about the shape of the
 * package that produced it. Someone holding that string still cannot act on
 * it. So this derives the topology, finds the conflicts in the mempool that is
 * actually running here, does the replacement arithmetic, and linearizes the
 * package with the same code the cluster pages use, so a package is described
 * in the same terms as everything already in the mempool.
 *
 * Nothing here decides acceptance. Where the node has spoken, its answer is
 * carried through unchanged; where it has not, the gap is named rather than
 * filled with a guess.
 */

export interface CandidateInput {
  readonly txid: string;
  readonly vout: number;
}

/** One transaction as the node's decoder read it. */
export interface CandidateTx {
  readonly txid: string;
  readonly vsize: number;
  readonly weight: number;
  readonly inputs: readonly CandidateInput[];
  /** Every output's value in satoshis, by position. */
  readonly outputValuesSats: readonly number[];
}

/** What `testmempoolaccept` said about one transaction. */
export interface NodeVerdict {
  readonly txid: string;
  readonly allowed: boolean;
  readonly rejectReason: string | null;
  /** The node's own virtual size, which is the one that counts. */
  readonly vsize: number | null;
  readonly feeSats: number | null;
  readonly effectiveFeerate: number | null;
  /** Txids the node included when it worked out the effective fee rate. */
  readonly effectiveIncludes: readonly string[];
}

/** A mempool transaction already spending an outpoint a candidate wants. */
export interface ConflictingTx {
  readonly txid: string;
  readonly feeSats: number;
  readonly vsize: number;
}

/**
 * Looks up the mempool this process holds.
 *
 * Passed in rather than imported so the arithmetic below can be tested
 * against a stated mempool instead of whatever the process happens to hold.
 */
export interface MempoolLookup {
  /** The mempool transaction spending this outpoint, if there is one. */
  spender(txid: string, vout: number): ConflictingTx | null;
  /** That transaction and everything descended from it, which all goes with it. */
  descendants(txid: string): readonly ConflictingTx[];
  /** True when this txid is in the mempool, so a candidate's parent is present. */
  has(txid: string): boolean;
  /** The value of one output of a mempool transaction, in satoshis. */
  outputValue(txid: string, vout: number): number | null;
}

export interface PackageTxView {
  readonly txid: string;
  readonly vsize: number;
  readonly weight: number;
  readonly feeSats: number | null;
  /** Why the fee is not known, when it is not. */
  readonly feeUnknownReason: string | null;
  readonly individualFeerate: number | null;
  /** The fee rate of the group this transaction would be mined in. */
  readonly effectiveFeerate: number | null;
  readonly chunkIndex: number | null;
  /** Package members this transaction spends from. */
  readonly parents: readonly string[];
  readonly children: readonly string[];
  /**
   * Inputs that come from neither the package nor the mempool, so they are
   * either confirmed or do not exist. The node's verdict settles which.
   */
  readonly externalInputs: number;
  /** Inputs that come from a transaction already in the mempool. */
  readonly mempoolInputs: number;
  readonly allowed: boolean;
  readonly rejectReason: string | null;
  readonly effectiveIncludes: readonly string[];
}

export interface ConflictView {
  /** The outpoint two transactions both want, as txid:vout. */
  readonly outpoint: string;
  /** The candidate that wants it. */
  readonly candidateTxid: string;
  /** The mempool transaction that already has it. */
  readonly incumbentTxid: string;
  /** The incumbent and everything descended from it, all of which would go. */
  readonly evictedTxids: readonly string[];
  readonly evictedFeeSats: number;
  readonly evictedVsize: number;
}

export interface ReplacementView {
  readonly conflictCount: number;
  /** Every distinct transaction that would leave the mempool. */
  readonly evictedTxids: readonly string[];
  readonly evictedFeeSats: number;
  readonly evictedVsize: number;
  readonly packageFeeSats: number;
  readonly packageVsize: number;
  /**
   * What the package has to pay: everything it evicts, plus the relay cost of
   * its own size at the node's incremental rate. This is the arithmetic the
   * replacement rules do, not an estimate of it.
   */
  readonly requiredFeeSats: number;
  /** How far short the package falls, or zero when it does not. */
  readonly shortfallSats: number;
  readonly satisfiesFeeRules: boolean;
  /** Set when the package fee is not fully known, so the sum is not a sum. */
  readonly incompleteReason: string | null;
}

export interface QueuePosition {
  /**
   * Virtual bytes of mempool that pay better than this package's best group.
   * Divided by the size of a block, this is roughly how many blocks are ahead
   * of it. It is a projection from the current mempool and nothing more: the
   * mempool changes, and a miner is free to build any block they like.
   */
  readonly vsizeAhead: number;
  readonly chunksAhead: number;
  /** The fee rate the position was worked out for. */
  readonly feerate: number;
}

export interface PackageSimulation {
  readonly transactions: readonly PackageTxView[];
  /** Package members in an order where every parent precedes its children. */
  readonly topologicalOrder: readonly string[];
  readonly chunks: readonly ChunkView[];
  /** True only when the node allowed every transaction. */
  readonly accepted: boolean;
  readonly conflicts: readonly ConflictView[];
  readonly replacement: ReplacementView | null;
  readonly queuePosition: QueuePosition | null;
  readonly packageFeeSats: number | null;
  readonly packageVsize: number;
  readonly packageWeight: number;
  /** True when the package forms one connected group rather than several. */
  readonly connected: boolean;
  /** Members whose inputs point at a member that comes later, which cannot be relayed. */
  readonly cyclic: boolean;
}

/** The relay cost per virtual byte, in satoshis, from the node's own policy. */
export interface Policy {
  readonly incrementalRelayFeeSatPerVb: number;
}

function outpointKey(txid: string, vout: number): string {
  return `${txid}:${vout}`;
}

/**
 * Orders the package so every parent comes before its children.
 *
 * A package whose order cannot be produced has a cycle in it, which no node
 * will relay. That is reported rather than worked around, because a cycle is
 * a fact about the package and not a difficulty for this function.
 */
function topologicalOrder(
  txids: readonly string[],
  parentsOf: ReadonlyMap<string, readonly string[]>,
): { order: string[]; cyclic: boolean } {
  const remaining = new Set(txids);
  const order: string[] = [];
  // A plain repeated sweep rather than a queue. A package is at most a couple
  // of dozen transactions, and a sweep is obviously correct at that size.
  let progress = true;
  while (remaining.size && progress) {
    progress = false;
    // Sorted so the same package always produces the same order, which is
    // what makes two runs of a simulation comparable.
    for (const txid of [...remaining].sort()) {
      const parents = parentsOf.get(txid) ?? [];
      if (parents.every((parent) => !remaining.has(parent))) {
        order.push(txid);
        remaining.delete(txid);
        progress = true;
      }
    }
  }
  return { order, cyclic: remaining.size > 0 };
}

/** True when every member reaches every other through parent or child edges. */
function isConnected(
  txids: readonly string[],
  parentsOf: ReadonlyMap<string, readonly string[]>,
): boolean {
  if (txids.length <= 1) { return true; }
  const neighbours = new Map<string, string[]>();
  for (const txid of txids) { neighbours.set(txid, []); }
  for (const [child, parents] of parentsOf) {
    for (const parent of parents) {
      neighbours.get(child)?.push(parent);
      neighbours.get(parent)?.push(child);
    }
  }
  const seen = new Set<string>([txids[0]]);
  const stack = [txids[0]];
  while (stack.length) {
    const current = stack.pop() as string;
    for (const next of neighbours.get(current) ?? []) {
      if (!seen.has(next)) { seen.add(next); stack.push(next); }
    }
  }
  return seen.size === txids.length;
}

/**
 * Works out where a fee rate sits in the mempool as it stands.
 *
 * Counts the virtual bytes that pay strictly better. Ties are not counted as
 * ahead, because a miner ordering equal rates has no reason to prefer either
 * and claiming otherwise would be a guess dressed as a position.
 */
export function queuePositionFor(
  feerate: number,
  mempoolChunks: readonly { feerate: number; vsize: number }[],
): QueuePosition {
  let vsizeAhead = 0;
  let chunksAhead = 0;
  for (const chunk of mempoolChunks) {
    if (compareFeerate(chunk.feerate, 1, feerate, 1) > 0) {
      vsizeAhead += chunk.vsize;
      chunksAhead += 1;
    }
  }
  return { vsizeAhead, chunksAhead, feerate };
}

/**
 * Describes what a node would do with a package.
 */
export function simulatePackage(options: {
  readonly candidates: readonly CandidateTx[];
  readonly verdicts: readonly NodeVerdict[];
  readonly mempool: MempoolLookup;
  readonly policy: Policy;
  /** The mempool's own groups, for the queue position. Omit to skip it. */
  readonly mempoolChunks?: readonly { feerate: number; vsize: number }[];
}): PackageSimulation {
  const { candidates, verdicts, mempool, policy } = options;
  const members = new Set(candidates.map((tx) => tx.txid));
  const verdictOf = new Map(verdicts.map((v) => [v.txid, v]));

  // Parent edges inside the package, and a count of where every other input
  // comes from. An input pointing at a package member is a package edge; one
  // pointing at the mempool is a chain this package extends; anything else is
  // outside both, and only the node can say whether it exists.
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  const mempoolInputCount = new Map<string, number>();
  const externalInputCount = new Map<string, number>();
  for (const tx of candidates) {
    parentsOf.set(tx.txid, []);
    childrenOf.set(tx.txid, []);
    mempoolInputCount.set(tx.txid, 0);
    externalInputCount.set(tx.txid, 0);
  }
  for (const tx of candidates) {
    for (const input of tx.inputs) {
      if (members.has(input.txid)) {
        parentsOf.get(tx.txid)?.push(input.txid);
        childrenOf.get(input.txid)?.push(tx.txid);
      } else if (mempool.has(input.txid)) {
        mempoolInputCount.set(tx.txid, (mempoolInputCount.get(tx.txid) ?? 0) + 1);
      } else {
        externalInputCount.set(tx.txid, (externalInputCount.get(tx.txid) ?? 0) + 1);
      }
    }
  }
  // A transaction spending the same parent twice would otherwise appear twice
  // as a parent, which would double count it everywhere downstream.
  for (const [txid, parents] of parentsOf) {
    parentsOf.set(txid, [...new Set(parents)]);
  }
  for (const [txid, children] of childrenOf) {
    childrenOf.set(txid, [...new Set(children)]);
  }

  const { order, cyclic } = topologicalOrder(candidates.map((t) => t.txid), parentsOf);

  // The fee. The node's figure is preferred wherever it gave one, because it
  // is the figure the node's own policy was applied to, and a rejected
  // transaction often has no figure at all.
  //
  // Where the node was silent the fee can still be worked out, but only when
  // every one of the transaction's inputs points at an output whose value is
  // in hand: another package member, or a mempool transaction. An input from
  // the confirmed chain is not, and a fee computed as if that input were
  // worth nothing would be enormous and confidently wrong. So the condition
  // is every input or none.
  const byTxid = new Map(candidates.map((tx) => [tx.txid, tx]));
  const feeOf = new Map<string, number>();
  const feeUnknownOf = new Map<string, string>();
  for (const tx of candidates) {
    const verdict = verdictOf.get(tx.txid);
    if (verdict?.feeSats !== null && verdict?.feeSats !== undefined) {
      feeOf.set(tx.txid, verdict.feeSats);
      continue;
    }
    let inputValue = 0;
    let resolvable = tx.inputs.length > 0;
    for (const input of tx.inputs) {
      const member = byTxid.get(input.txid);
      const value = member
        ? member.outputValuesSats[input.vout] ?? null
        : mempool.outputValue(input.txid, input.vout);
      if (value === null || value === undefined) { resolvable = false; break; }
      inputValue += value;
    }
    if (resolvable) {
      const outputValue = tx.outputValuesSats.reduce((sum, value) => sum + value, 0);
      feeOf.set(tx.txid, inputValue - outputValue);
      continue;
    }
    feeUnknownOf.set(
      tx.txid,
      verdict
        ? 'The node reported no fee for this transaction and at least one of its inputs spends an output this process cannot see, so the fee is not known.'
        : 'The node gave no verdict for this transaction, so its fee is not known here.',
    );
  }

  // Linearizing needs a fee for every member. Where one is missing the
  // package cannot be grouped at all, because a group's rate is a sum and a
  // sum with a hole in it is not a sum.
  const everyFeeKnown = candidates.every((tx) => feeOf.has(tx.txid));
  const chunks: ChunkView[] = [];
  const chunkIndexOf = new Map<string, number>();
  const effectiveFeerateOf = new Map<string, number>();
  if (everyFeeKnown && !cyclic) {
    const inputs: ClusterInputTx[] = candidates.map((tx) => ({
      txid: tx.txid,
      vsize: verdictOf.get(tx.txid)?.vsize ?? tx.vsize,
      weight: tx.weight,
      fee: feeOf.get(tx.txid) as number,
      parents: parentsOf.get(tx.txid) ?? [],
    }));
    for (const cluster of buildClusters(inputs)) {
      for (const chunk of cluster.chunks) {
        const index = chunks.length;
        chunks.push({ ...chunk, index });
        for (const txid of chunk.txids) {
          chunkIndexOf.set(txid, index);
          effectiveFeerateOf.set(txid, chunk.feerate);
        }
      }
    }
    // Groups are reported best rate first, which is the order a miner takes
    // them in and the order the cluster pages already use.
    chunks.sort((left, right) => compareFeerate(right.feeSats, right.vsize, left.feeSats, left.vsize));
    chunks.forEach((chunk, index) => {
      for (const txid of chunk.txids) { chunkIndexOf.set(txid, index); }
    });
  }

  const transactions: PackageTxView[] = candidates.map((tx) => {
    const verdict = verdictOf.get(tx.txid);
    const fee = feeOf.get(tx.txid) ?? null;
    const vsize = verdict?.vsize ?? tx.vsize;
    return {
      txid: tx.txid,
      vsize,
      weight: tx.weight,
      feeSats: fee,
      feeUnknownReason: feeUnknownOf.get(tx.txid) ?? null,
      individualFeerate: fee === null || vsize <= 0 ? null : fee / vsize,
      effectiveFeerate: effectiveFeerateOf.get(tx.txid)
        ?? verdict?.effectiveFeerate
        ?? null,
      chunkIndex: chunkIndexOf.get(tx.txid) ?? null,
      parents: parentsOf.get(tx.txid) ?? [],
      children: childrenOf.get(tx.txid) ?? [],
      externalInputs: externalInputCount.get(tx.txid) ?? 0,
      mempoolInputs: mempoolInputCount.get(tx.txid) ?? 0,
      allowed: verdict?.allowed ?? false,
      rejectReason: verdict?.rejectReason
        ?? (verdict ? null : 'The node gave no verdict for this transaction.'),
      effectiveIncludes: verdict?.effectiveIncludes ?? [],
    };
  });

  // Conflicts. A candidate spending an outpoint the mempool has already given
  // to someone else is a replacement, and the incumbent does not leave alone:
  // everything descended from it goes too, because those children spend
  // outputs that would no longer exist.
  const conflicts: ConflictView[] = [];
  const evicted = new Map<string, ConflictingTx>();
  for (const tx of candidates) {
    for (const input of tx.inputs) {
      if (members.has(input.txid)) { continue; }
      const incumbent = mempool.spender(input.txid, input.vout);
      if (!incumbent || members.has(incumbent.txid)) { continue; }
      const family = mempool.descendants(incumbent.txid);
      for (const member of family) { evicted.set(member.txid, member); }
      conflicts.push({
        outpoint: outpointKey(input.txid, input.vout),
        candidateTxid: tx.txid,
        incumbentTxid: incumbent.txid,
        evictedTxids: family.map((member) => member.txid),
        evictedFeeSats: family.reduce((sum, member) => sum + member.feeSats, 0),
        evictedVsize: family.reduce((sum, member) => sum + member.vsize, 0),
      });
    }
  }

  const packageVsize = transactions.reduce((sum, tx) => sum + tx.vsize, 0);
  const packageWeight = transactions.reduce((sum, tx) => sum + tx.weight, 0);
  const packageFeeSats = everyFeeKnown
    ? transactions.reduce((sum, tx) => sum + (tx.feeSats as number), 0)
    : null;

  let replacement: ReplacementView | null = null;
  if (conflicts.length) {
    const family = [...evicted.values()];
    const evictedFeeSats = family.reduce((sum, member) => sum + member.feeSats, 0);
    const evictedVsize = family.reduce((sum, member) => sum + member.vsize, 0);
    const requiredFeeSats = evictedFeeSats
      + Math.ceil(policy.incrementalRelayFeeSatPerVb * packageVsize);
    const known = packageFeeSats !== null;
    const shortfallSats = known ? Math.max(0, requiredFeeSats - (packageFeeSats as number)) : 0;
    replacement = {
      conflictCount: conflicts.length,
      evictedTxids: family.map((member) => member.txid).sort(),
      evictedFeeSats,
      evictedVsize,
      packageFeeSats: packageFeeSats ?? 0,
      packageVsize,
      requiredFeeSats,
      shortfallSats,
      satisfiesFeeRules: known && shortfallSats === 0,
      incompleteReason: known
        ? null
        : 'At least one fee in this package is not known, so the total it would have to beat cannot be compared against it.',
    };
  }

  const bestChunk = chunks[0];
  const queuePosition = bestChunk && options.mempoolChunks
    ? queuePositionFor(bestChunk.feerate, options.mempoolChunks)
    : null;

  return {
    transactions,
    topologicalOrder: order,
    chunks,
    accepted: verdicts.length === candidates.length && verdicts.every((v) => v.allowed),
    conflicts,
    replacement,
    queuePosition,
    packageFeeSats,
    packageVsize,
    packageWeight,
    connected: isConnected(candidates.map((tx) => tx.txid), parentsOf),
    cyclic,
  };
}
