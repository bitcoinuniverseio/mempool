import config from '../config';
import logger from '../logger';
import { MempoolTransactionExtended, TransactionStripped } from '../mempool.interfaces';
import bitcoinApi from './bitcoin/bitcoin-api-factory';
import { IEsploraApi } from './bitcoin/esplora-api.interface';
import { RbfTxMetadata, RbfMetadataInput } from './rbf-metadata';
import { RbfBodyStore } from './rbf-body-store';
import { RbfRawBackingCandidate } from './rbf-raw-backing';
import { RbfHistoryManifest, writeRbfHistoryManifest } from './rbf-history-manifest';
import { validateRbfSnapshot, RbfSnapshotError } from './rbf-snapshot';
import redisCache from './redis-cache';
import { rbfRestoreState } from './rbf-snapshot';

/** Concurrent RPC reads when a restored RBF cache is checked against the node. */
export const RBF_CHECK_CONCURRENCY = 8;

export interface RbfTransaction extends TransactionStripped {
  rbf?: boolean;
  mined?: boolean;
  fullRbf?: boolean;
}

export interface RbfTree {
  tx: RbfTransaction;
  time: number;
  interval?: number;
  mined?: boolean;
  fullRbf: boolean;
  replaces: RbfTree[];
}

export interface ReplacementInfo {
  mined: boolean;
  fullRbf: boolean;
  txid: string;
  oldFee: number;
  oldVsize: number;
  newFee: number;
  newVsize: number;
}

enum CacheOp {
  Remove = 0,
  Add = 1,
  Change = 2,
}

interface CacheEvent {
  op: CacheOp;
  type: 'tx' | 'tree' | 'exp';
  txid: string,
  value?: any,
}

/**
 * Singleton for tracking RBF trees
 *
 * Maintains a set of RBF trees, where each tree represents a sequence of
 * consecutive RBF replacements.
 *
 * Trees are identified by the txid of the root transaction.
 *
 * To maintain consistency, the following invariants must be upheld:
 *  - Symmetry: replacedBy(A) = B <=> A in replaces(B)
 *  - Unique id: treeMap(treeMap(X)) = treeMap(X)
 *  - Unique tree: A in replaces(B) => treeMap(A) == treeMap(B)
 *  - Existence: X in treeMap => treeMap(X) in rbfTrees
 *  - Completeness: X in replacedBy => X in treeMap, Y in replaces => Y in treeMap
 */

export class RbfCache {
  private replacedBy: Map<string, string> = new Map();
  // Told about every replacement the cache records; used by the watchlist matcher.
  private replacementListeners: ((replacedTxid: string, replacementTxid: string) => void)[] = [];
  private replaces: Map<string, string[]> = new Map();
  private rbfTrees: Map<string, RbfTree> = new Map(); // sequences of consecutive replacements
  private dirtyTrees: Set<string> = new Set();
  private treeMap: Map<string, string> = new Map(); // map of txids to sequence ids
  private txs: Map<string, RbfTxMetadata> = new Map();
  private bodies = new RbfBodyStore();
  private metadataBytes = 0;
  private version = 0;
  private savingHistory: Promise<void> | null = null;
  private expiring: Map<string, number> = new Map();
  private cacheQueue: CacheEvent[] = [];

  private evictionCount = 0;
  private staleCount = 0;
  private cleanupTimer: NodeJS.Timeout | null;

  constructor() {
    this.cleanupTimer = setInterval(this.cleanup.bind(this), 1000 * 60 * 10);
  }

  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Low level cache operations
   */

  private queueCacheEvent(event: CacheEvent): void {
    // This queue serves Redis persistence only; disabled Redis has no consumer.
    if (config.REDIS.ENABLED && rbfRestoreState.canQueuePersistence) { this.cacheQueue.push(event); }
  }

  private addTx(txid: string, tx: MempoolTransactionExtended | RbfTxMetadata): void {
    this.version++;
    const metadata = tx instanceof RbfTxMetadata ? tx : new RbfTxMetadata(tx);
    if (!this.txs.has(txid)) { this.metadataBytes += metadata.budgetBytes; }
    this.txs.set(txid, metadata);
    this.queueCacheEvent({ op: CacheOp.Add, type: 'tx', txid });
  }

  private addTree(txid: string, tree: RbfTree): void {
    this.version++;
    this.rbfTrees.set(txid, tree);
    if (!rbfRestoreState.unavailable) { this.dirtyTrees.add(txid); }
    this.queueCacheEvent({ op: CacheOp.Add, type: 'tree', txid });
  }

  private addExpiration(txid: string, expiry: number): void {
    this.version++;
    this.expiring.set(txid, expiry);
    this.queueCacheEvent({ op: CacheOp.Add, type: 'exp', txid, value: expiry });
  }

  private removeTx(txid: string): void {
    this.version++;
    this.metadataBytes -= this.txs.get(txid)?.budgetBytes || 0;
    this.txs.delete(txid); this.bodies.remove(txid);
    this.queueCacheEvent({ op: CacheOp.Remove, type: 'tx', txid });
  }

  private removeTree(txid: string): void {
    this.version++;
    this.rbfTrees.delete(txid);
    this.queueCacheEvent({ op: CacheOp.Remove, type: 'tree', txid });
  }

  private removeExpiration(txid: string): void {
    this.version++;
    this.expiring.delete(txid);
    this.queueCacheEvent({ op: CacheOp.Remove, type: 'exp', txid });
  }

  /**
   * Basic data structure operations
   * must uphold tree invariants
   */


  public add(replaced: Array<MempoolTransactionExtended | RbfTxMetadata>, newTxExtended: MempoolTransactionExtended): void {
    if ( !newTxExtended
      || !replaced?.length
      || this.txs.has(newTxExtended.txid)
      || !(replaced.some(tx => !this.replacedBy.has(tx.txid)))
    ) {
      return;
    }

    newTxExtended.replacement = true;
    try {
      const incoming = [newTxExtended, ...replaced.filter(tx => !this.txs.has(tx.txid))];
      const metadata = incoming.map(tx => tx instanceof RbfTxMetadata ? tx : new RbfTxMetadata(tx));
      if (this.metadataBytes + metadata.reduce((bytes, tx) => bytes + tx.budgetBytes, 0) > 16 * 1024 * 1024) { throw new Error('RBF metadata budget exceeded'); }
      this.bodies.captureBatch(incoming.filter((tx): tx is MempoolTransactionExtended => !(tx instanceof RbfTxMetadata)));
    } catch { rbfRestoreState.fail('snapshot-oversize'); return; }
    const newTx = { ...new RbfTxMetadata(newTxExtended).stripped } as RbfTransaction;
    const newTime = newTxExtended.firstSeen || (Date.now() / 1000);
    newTx.rbf = newTxExtended.vin.some((v) => v.sequence < 0xfffffffe);
    this.addTx(newTx.txid, newTxExtended);

    // maintain rbf trees
    let txFullRbf = false;
    let treeFullRbf = false;
    const replacedTrees: RbfTree[] = [];
    for (const replacedTxExtended of replaced) {
      const metadata = replacedTxExtended instanceof RbfTxMetadata ? replacedTxExtended : new RbfTxMetadata(replacedTxExtended);
      const replacedTx = { ...metadata.stripped } as RbfTransaction;
      replacedTx.rbf = metadata.signalsRbf;
      if (!replacedTx.rbf) {
        txFullRbf = true;
      }
      if (this.replacedBy.has(replacedTx.txid)) {
        // should never happen
        continue;
      }
      this.replacedBy.set(replacedTx.txid, newTx.txid);
      for (const listener of this.replacementListeners) {
        try { listener(replacedTx.txid, newTx.txid); } catch (e) { logger.debug('rbf replacement listener failed: ' + (e instanceof Error ? e.message : e)); }
      }
      if (this.treeMap.has(replacedTx.txid)) {
        const treeId = this.treeMap.get(replacedTx.txid);
        if (treeId) {
          const tree = this.rbfTrees.get(treeId);
          this.removeTree(treeId);
          if (tree) {
            tree.interval = newTime - tree?.time;
            replacedTrees.push(tree);
            treeFullRbf = treeFullRbf || tree.fullRbf || !tree.tx.rbf;
          }
        }
      } else {
        const replacedTime = replacedTxExtended.firstSeen || (Date.now() / 1000);
        replacedTrees.push({
          tx: replacedTx,
          time: replacedTime,
          interval: newTime - replacedTime,
          fullRbf: !replacedTx.rbf,
          replaces: [],
        });
        treeFullRbf = treeFullRbf || !replacedTx.rbf;
        this.addTx(replacedTx.txid, replacedTxExtended);
      }
    }
    newTx.fullRbf = txFullRbf;
    const newTree = {
      tx: newTx,
      time: newTime,
      fullRbf: treeFullRbf,
      replaces: replacedTrees
    };
    this.addTree(newTree.tx.txid, newTree);
    this.updateTreeMap(newTree.tx.txid, newTree);
    this.replaces.set(newTx.txid, replacedTrees.map(tree => tree.tx.txid));
  }

  public mined(txid): void {
    if (!this.txs.has(txid)) {
      return;
    }
    const treeId = this.treeMap.get(txid);
    if (treeId && this.rbfTrees.has(treeId)) {
      const tree = this.rbfTrees.get(treeId);
      if (tree) {
        this.setTreeMined(tree, txid);
        tree.mined = true;
        if (!rbfRestoreState.unavailable) { this.dirtyTrees.add(treeId); }
        this.queueCacheEvent({ op: CacheOp.Change, type: 'tree', txid: treeId });
      }
    }
    this.evict(txid);
  }

  // flag a transaction as removed from the mempool
  public evict(txid: string, fast: boolean = false): void {
    this.evictionCount++;
    if (this.txs.has(txid) && (fast || !this.expiring.has(txid))) {
      const expiryTime = fast ? Date.now() + (1000 * 60 * 10) : Date.now() + (1000 * 86400); // 24 hours
      this.addExpiration(txid, expiryTime);
    }
  }

  /**
   * Read-only public interface
   */

  public has(txId: string): boolean {
    return this.txs.has(txId);
  }

  public anyInSameTree(txId: string, predicate: (tx: RbfTransaction) => boolean): boolean {
    const tree = this.getRbfTree(txId);
    if (!tree) {
      return false;
    }
    const txs = this.getTransactionsInTree(tree);
    for (const tx of txs) {
      if (predicate(tx)) {
        return true;
      }
    }
    return false;
  }

  public onReplacement(listener: (replacedTxid: string, replacementTxid: string) => void): void {
    this.replacementListeners.push(listener);
  }

  public getReplacedBy(txId: string): string | undefined {
    return this.replacedBy.get(txId);
  }

  public getReplaces(txId: string): string[] | undefined {
    return this.replaces.get(txId);
  }

  public hasBody(txId: string): boolean { return this.txs.has(txId) && this.bodies.has(txId); }

  /** @asyncUnsafe Complete raw JSON only; caller owns cancellation/backpressure and partial-response failure. */
  public async *body(txId: string, signal?: AbortSignal): AsyncIterable<Buffer> { yield* this.bodies.body(txId, signal); }

  /** @asyncUnsafe Existing cache directory only; no new canonical producer or RPC. */
  public configureBodyPersistence(root: string): Promise<void> { return this.bodies.configure(root); }

  /** @asyncUnsafe Drain actual body reads/writes before resource release. */
  public async closeBodies(): Promise<void> { if (this.savingHistory) { await this.savingHistory; } await this.bodies.close(); }

  public freezeLiveBody(tx: MempoolTransactionExtended): void {
    if (!this.txs.has(tx.txid)) { return; }
    try {
      const previous = this.txs.get(tx.txid), current = new RbfTxMetadata(tx);
      const proposed = this.metadataBytes + current.budgetBytes - (previous?.budgetBytes || 0);
      if (proposed > 16 * 1024 * 1024) { throw new RbfSnapshotError('snapshot-oversize'); }
      if (this.bodies.freezeLive(tx)) {
        this.metadataBytes = proposed; this.txs.set(tx.txid, current);
      }
    }
    catch { rbfRestoreState.fail('snapshot-oversize'); }
    this.version++;
  }

  /** @asyncUnsafe Only complete immutable body references are published; ordinary growth retries next save. */
  public saveHistory(root: string, network: string): Promise<void> {
    if (this.savingHistory) { return this.savingHistory; }
    const job = this.persistHistory(root, network);
    this.savingHistory = job.catch(e => { rbfRestoreState.fail(e instanceof RbfSnapshotError ? e.code : 'snapshot-restore-failed'); throw e; })
      .finally(() => { this.savingHistory = null; }); return this.savingHistory;
  }

  /** @asyncUnsafe The old pointer survives failure; original legacy file is never overwritten. */
  private async persistHistory(root: string, network: string): Promise<void> {
    const updates = this.bodies.liveInputs().map(input => [input.txid, new RbfTxMetadata(input)] as const);
    const proposed = updates.reduce((bytes, [id, current]) => bytes + current.budgetBytes - (this.txs.get(id)?.budgetBytes || 0), this.metadataBytes);
    if (proposed > 16 * 1024 * 1024) { throw new RbfSnapshotError('snapshot-oversize'); }
    this.bodies.refreshLive();
    for (const [id, current] of updates) { this.txs.set(id, current); }
    this.metadataBytes = proposed;
    const version = this.version, metadata = Array.from(this.txs.entries());
    const trees = Array.from(this.rbfTrees.values(), tree => this.exportTree(tree));
    const expiring = Array.from(this.expiring.entries());
    await this.bodies.configure(root); await this.bodies.flush();
    if (this.version !== version) { return; }
    const bodies = this.bodies.references(metadata.map(([id]) => id));
    if (bodies.some(body => !body.file && !body.sourceFile)) { throw new Error('RBF complete body persistence unavailable'); }
    const protectedFiles = await writeRbfHistoryManifest(root, { schemaVersion: 'mempool-rbf-history-v2', network, metadata, bodies, trees, expiring });
    this.bodies.maintainSegments(protectedFiles);
  }

  /** @asyncSafe Manifest/body correspondence and original graph guards run before native qualification. */
  public async loadManifest(root: string, manifest: RbfHistoryManifest, mempool: any, spendMap: any): Promise<boolean> {
    try {
      await this.bodies.configure(root);
      const inputs = await this.bodies.loadReferences(manifest.bodies, manifest.network);
      const metadata = inputs.map(input => new RbfTxMetadata(input));
      if (JSON.stringify(metadata.map(tx => [tx.txid, tx])) !== JSON.stringify(manifest.metadata)) { throw new Error('RBF manifest metadata mismatch'); }
      validateRbfSnapshot({ network: manifest.network, rbfCacheSchemaVersion: 1,
        rbf: { txs: inputs.map(input => [input.txid, input]), trees: manifest.trees, expiring: manifest.expiring } }, manifest.network);
      return this.load({ txs: inputs.map(value => ({ value })), trees: manifest.trees,
        expiring: manifest.expiring.map(([key, value]) => ({ key, value })), mempool, spendMap, bodiesLoaded: true });
    } catch { return false; }
  }

  public getRbfTree(txId: string): RbfTree | void {
    return this.rbfTrees.get(this.treeMap.get(txId) || '');
  }

  // get a paginated list of RbfTrees
  // ordered by most recent replacement time
  public getRbfTrees(onlyFullRbf: boolean, after?: string): RbfTree[] {
    const limit = 25;
    const trees: RbfTree[] = [];
    const used = new Set<string>();
    const replacements: string[][] = Array.from(this.replacedBy).reverse();
    const afterTree = after ? this.treeMap.get(after) : null;
    let ready = !afterTree;
    for (let i = 0; i < replacements.length && trees.length <= limit - 1; i++) {
      const txid = replacements[i][1];
      const treeId = this.treeMap.get(txid) || '';
      if (treeId === afterTree) {
        ready = true;
      } else if (ready) {
        if (!used.has(treeId)) {
          const tree = this.rbfTrees.get(treeId);
          used.add(treeId);
          if (tree && (!onlyFullRbf || tree.fullRbf)) {
            trees.push(tree);
          }
        }
      }
    }
    return trees;
  }

  // get map of rbf trees that have been updated since the last call
  public getRbfChanges(): { trees: {[id: string]: RbfTree }, map: { [txid: string]: string }} {
    const changes: { trees: {[id: string]: RbfTree }, map: { [txid: string]: string }} = {
      trees: {},
      map: {},
    };
    this.dirtyTrees.forEach(id => {
      const tree = this.rbfTrees.get(id);
      if (tree) {
        changes.trees[id] = tree;
        this.getTransactionsInTree(tree).forEach(tx => {
          changes.map[tx.txid] = id;
        });
      }
    });
    this.dirtyTrees = new Set();
    return changes;
  }

  // is the transaction involved in a full rbf replacement?
  public isFullRbf(txid: string): boolean {
    const treeId = this.treeMap.get(txid);
    if (!treeId) {
      return false;
    }
    const tree = this.rbfTrees.get(treeId);
    if (!tree) {
      return false;
    }
    return tree?.fullRbf;
  }

  /**
   * Cache maintenance & utility functions
   */

  private cleanup(): void {
    const now = Date.now();
    for (const txid of this.expiring.keys()) {
      if ((this.expiring.get(txid) || 0) < now) {
        this.removeExpiration(txid);
        this.remove(txid);
      }
    }
    logger.debug(`rbf cache contains ${this.txs.size} txs, ${this.rbfTrees.size} trees, ${this.expiring.size} due to expire (${this.evictionCount} newly expired)`);
    this.evictionCount = 0;
  }

  // remove a transaction & all previous versions from the cache
  private remove(txid): void {
    // don't remove a transaction if a newer version remains in the mempool
    if (!this.replacedBy.has(txid)) {
      const root = this.treeMap.get(txid);
      const replaces = this.replaces.get(txid);
      this.replaces.delete(txid);
      this.treeMap.delete(txid);
      this.removeTx(txid);
      this.removeExpiration(txid);
      if (root === txid) {
        this.removeTree(txid);
      }
      for (const tx of (replaces || [])) {
        // recursively remove prior versions from the cache
        this.replacedBy.delete(tx);
        this.remove(tx);
      }
    }
  }

  private updateTreeMap(newId: string, tree: RbfTree): void {
    this.treeMap.set(tree.tx.txid, newId);
    tree.replaces.forEach(subtree => {
      this.updateTreeMap(newId, subtree);
    });
  }

  private getTransactionsInTree(tree: RbfTree, txs: RbfTransaction[] = []): RbfTransaction[] {
    txs.push(tree.tx);
    tree.replaces.forEach(subtree => {
      this.getTransactionsInTree(subtree, txs);
    });
    return txs;
  }

  private setTreeMined(tree: RbfTree, txid: string): void {
    this.version++;
    if (tree.tx.txid === txid) {
      tree.tx.mined = true;
    } else {
      tree.replaces.forEach(subtree => {
        this.setTreeMined(subtree, txid);
      });
    }
  }

  /** @asyncUnsafe Callers own failure; immutable body data is retained and historical publication fails closed. */
  public async updateCache(): Promise<void> {
    try {
    if (rbfRestoreState.unavailable) {
      this.cacheQueue = [];
      return;
    }
    await this.bodies.flush();
    if (!config.REDIS.ENABLED) { this.cacheQueue = []; return; }
    // Update the Redis cache by replaying queued events
    for (const e of this.cacheQueue) {
      if (e.op === CacheOp.Add || e.op === CacheOp.Change) {
        let value = e.value;
          switch(e.type) {
            case 'tx': {
              value = this.txs.has(e.txid) ? await this.bodies.json(e.txid) : null;
            } break;
            case 'tree': {
              const tree = this.rbfTrees.get(e.txid);
              value = tree ? this.exportTree(tree) : null;
            } break;
          }
          if (value != null) {
            if (e.type === 'tx') { await redisCache.$setRbfRawEntry(e.txid, value); }
            else { await redisCache.$setRbfEntry(e.type, e.txid, value); }
          }
      } else if (e.op === CacheOp.Remove) {
        await redisCache.$removeRbfEntry(e.type, e.txid);
      }
    }
    this.cacheQueue = [];
    } catch (e) { rbfRestoreState.fail(e instanceof RbfSnapshotError ? e.code : 'snapshot-restore-failed'); throw e; }
  }

  public dump(): any {
    const trees = Array.from(this.rbfTrees.values()).map((tree: RbfTree) => { return this.exportTree(tree); });

    return {
      txs: Array.from(this.txs.keys(), txid => [txid, this.bodies.memoryValue(txid)]),
      trees,
      expiring: Array.from(this.expiring.entries()),
    };
  }

  /** @asyncSafe */
  public async load({ txs, trees, expiring, mempool, spendMap, backing, backingFile, bodiesLoaded }: { txs: Array<{ value: RbfMetadataInput }>; trees: any[]; expiring: Array<{ key: string; value: number }>; mempool: any; spendMap: any; backing?: RbfRawBackingCandidate; backingFile?: string; bodiesLoaded?: boolean }): Promise<boolean> {
    try {
      const metadata = txs.map(txEntry => new RbfTxMetadata(txEntry.value));
      if (metadata.reduce((bytes, tx) => bytes + tx.budgetBytes, 0) > 16 * 1024 * 1024) { throw new Error('RBF metadata budget exceeded'); }
      if (backing) { this.bodies.adopt(backing, backingFile); } else if (!bodiesLoaded) { this.bodies.captureBatch(txs.map(entry => entry.value), false); }
      for (const tx of metadata) { this.addTx(tx.txid, tx); }
      this.staleCount = 0;
      for (const deflatedTree of trees.sort((a, b) => Object.keys(b).length - Object.keys(a).length)) {
        const tree = await this.importTree(mempool, deflatedTree.root, deflatedTree.root, deflatedTree, this.txs);
        if (tree) {
          this.addTree(tree.tx.txid, tree);
          this.updateTreeMap(tree.tx.txid, tree);
          if (tree.mined) {
            this.evict(tree.tx.txid);
          }
        }
      }
      expiring.forEach(expiringEntry => {
        if (this.txs.has(expiringEntry.key)) {
          this.expiring.set(expiringEntry.key, new Date(expiringEntry.value).getTime());
        }
      });
      this.staleCount = 0;

      // connect cached trees to current mempool transactions
      const conflicts: Record<string, { replacedBy: MempoolTransactionExtended, replaces: Set<RbfTxMetadata> }> = {};
      for (const tree of this.rbfTrees.values()) {
        const tx = this.txs.get(tree.tx.txid);
        if (!tx || tree.mined) {
          continue;
        }
        for (const vin of tx.spends) {
          const conflict = spendMap.get(`${vin.txid}:${vin.vout}`);
          if (conflict && conflict.txid !== tx.txid) {
            if (!conflicts[conflict.txid]) {
              conflicts[conflict.txid] = {
                replacedBy: conflict,
                replaces: new Set(),
              };
            }
            conflicts[conflict.txid].replaces.add(tx);
          }
        }
      }
      for (const { replacedBy, replaces } of Object.values(conflicts)) {
        this.add([...replaces.values()], replacedBy);
      }

      await this.checkTrees();
      logger.debug(`loaded ${txs.length} txs, ${trees.length} trees into rbf cache, ${expiring.length} due to expire, ${this.staleCount} were stale`);
      this.cleanup();
      return true;

    } catch (e) {
      logger.err('failed to restore RBF cache');
      return false;
    }
  }

  exportTree(tree: RbfTree, deflated: any = null) {
    if (!deflated) {
      deflated = {
        root: tree.tx.txid,
      };
    }
    deflated[tree.tx.txid] = {
      tx: tree.tx.txid,
      txMined: tree.tx.mined,
      time: tree.time,
      interval: tree.interval,
      mined: tree.mined,
      fullRbf: tree.fullRbf,
      replaces: tree.replaces.map(child => child.tx.txid),
    };
    tree.replaces.forEach(child => {
      this.exportTree(child, deflated);
    });
    return deflated;
  }

  importTree(mempool, root, txid, deflated, txs: Map<string, RbfTxMetadata>, mined: boolean = false): RbfTree | void {
    const treeInfo = deflated[txid];
    const replaces: RbfTree[] = [];

    // if the root tx is unknown, remove this tree and return early
    if (root === txid && !txs.has(txid)) {
      this.staleCount++;
      this.removeTree(deflated.key);
      return;
    }

    // if this tx is already in the cache, return early
    if (this.treeMap.has(txid)) {
      this.removeTree(deflated.key);
      return;
    }

    // recursively reconstruct child trees
    for (const childId of treeInfo.replaces) {
      const replaced = this.importTree(mempool, root, childId, deflated, txs, mined);
      if (replaced) {
        this.replacedBy.set(replaced.tx.txid, txid);
        if (mempool[replaced.tx.txid]) {
          mempool[replaced.tx.txid].replacement = true;
        }
        replaces.push(replaced);
        if (replaced.mined) {
          mined = true;
        }
      }
    }
    this.replaces.set(txid, replaces.map(t => t.tx.txid));

    const tx = txs.get(txid);
    if (!tx) {
      return;
    }
    const strippedTx = { ...tx.stripped } as RbfTransaction;
    strippedTx.rbf = tx.signalsRbf;
    strippedTx.mined = treeInfo.txMined;
    const tree = {
      tx: strippedTx,
      time: treeInfo.time,
      interval: treeInfo.interval,
      mined: mined,
      fullRbf: treeInfo.fullRbf,
      replaces,
    };
    return tree;
  }

  private async checkTrees(): Promise<void> {
    const found: { [txid: string]: boolean } = {};
    const txids = Array.from(this.txs.values()).map(tx => tx.txid).filter(txid => {
      return !this.expiring.has(txid) && !this.getRbfTree(txid)?.mined;
    });

    const processTxs = (txs: IEsploraApi.Transaction[], expected: string[]): void => {
      if (!Array.isArray(txs) || txs.length !== expected.length) { throw new Error('Incomplete RBF transaction qualification'); }
      const seen = new Set<string>();
      for (const tx of txs) {
        if (!tx || !expected.includes(tx.txid) || seen.has(tx.txid) || typeof tx.status?.confirmed !== 'boolean'
          || tx.status.confirmed && (!Number.isSafeInteger(tx.status.block_height) || tx.status.block_height! < 0
            || !/^[0-9a-f]{64}$/.test(tx.status.block_hash ?? '') || !Number.isSafeInteger(tx.status.block_time) || tx.status.block_time! < 0)) {
          throw new Error('Invalid RBF transaction qualification');
        }
        seen.add(tx.txid);
      }
      for (const tx of txs) {
        found[tx.txid] = true;
        if (tx.status?.confirmed) {
          const tree = this.getRbfTree(tx.txid);
          if (tree) {
            this.setTreeMined(tree, tx.txid);
            tree.mined = true;
            this.evict(tx.txid, false);
          }
        }
      }
    };

    let failedReads = false;
    if (config.MEMPOOL.BACKEND === 'esplora') {
      let processedCount = 0;
      const sliceLength = Math.ceil(config.ESPLORA.BATCH_QUERY_BASE_SIZE / 40);
      for (let i = 0; i < Math.ceil(txids.length / sliceLength); i++) {
        const slice = txids.slice(i * sliceLength, (i + 1) * sliceLength);
        processedCount += slice.length;
        try {
          const txs = await bitcoinApi.$getRawTransactions(slice);
          processTxs(txs, slice);
          logger.debug(`fetched and processed ${processedCount} of ${txids.length} cached rbf transactions (${(processedCount / txids.length * 100).toFixed(2)}%)`);
        } catch (err) {
          failedReads = true;
          logger.err(`failed to fetch or process ${slice.length} cached rbf transactions`);
        }
      }
    } else {
      // Read with a small fixed pool rather than one at a time. This runs
      // before the HTTP server listens, and on 2026-09-23 a cache of 8,044
      // unexpired transactions read sequentially through the Core RPC tunnel
      // held the whole API down for about half an hour on every restart. The
      // pool stays well inside the shared RPC budget.
      let next = 0;
      const worker = async (): Promise<void> => {
        while (next < txids.length) {
          const txid = txids[next++];
          try {
            // Process each bounded worker result immediately; do not retain all full responses.
            processTxs([await bitcoinApi.$getRawTransaction(txid, false, false)], [txid]);
          } catch (err) {
            // This path is Core RPC, including Electrum's inherited transaction reader.
            // HTTP404 is an endpoint failure; only Core's structured TX-notfound is absence.
            const failure = err as { code?: unknown; rpcMethod?: unknown } | null;
            if (failure?.code !== -5 || failure.rpcMethod !== 'getrawtransaction') { failedReads = true; }
          }
        }
      };
      const completed = await Promise.allSettled(Array.from({ length: Math.min(RBF_CHECK_CONCURRENCY, txids.length) }, () => worker()));
      if (completed.some(result => result.status === 'rejected')) { failedReads = true; }
    }

    // Every worker has completed. Unknown source failures cannot schedule missing expiry.
    if (failedReads) { throw new Error('RBF native transaction qualification was incomplete'); }
    // evict transactions genuinely absent from the qualified Core response
    for (const txid of txids) {
      if (!found[txid]) {
        this.evict(txid, false);
      }
    }
  }

  public getLatestRbfSummary(): ReplacementInfo[] {
    const rbfList = this.getRbfTrees(false);
    return rbfList.slice(0, 6).map(rbfTree => {
      let oldFee = 0;
      let oldVsize = 0;
      for (const replaced of rbfTree.replaces) {
        oldFee += replaced.tx.fee;
        oldVsize += replaced.tx.vsize;
      }
      return {
        txid: rbfTree.tx.txid,
        mined: !!rbfTree.tx.mined,
        fullRbf: !!rbfTree.tx.fullRbf,
        oldFee,
        oldVsize,
        newFee: rbfTree.tx.fee,
        newVsize: rbfTree.tx.vsize,
      };
    });
  }
}

export default new RbfCache();
