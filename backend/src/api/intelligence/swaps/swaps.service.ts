import { SwapPackage, SwapProtocolDefinition, SwapProvider, SwapLockupVerification, SwapClaimVerification, SwapRefundVerification, SwapRecoveryPlan, SwapsOverview, SwapContext } from './swaps.models';
import { BitcoinSwapAuthority, LockupEvidence, SwapAuthority, SwapEvidenceError, swapContext } from './swaps-evidence';
import { boltzContract, refundPsbt, verifyBoltzSpend } from './boltz-taproot';
import { DatabaseSwapObservations, SwapObservationStore } from './swaps-observations';

const providerRegistryUnavailable = 'The authenticated provider registry is unavailable. Provider identities and health history cannot be determined until the owned trust and signed-manifest integration is configured (PRE-04).';

export class SwapsService {
  private readonly protocols: SwapProtocolDefinition[] = [
    {
      protocol_id: 'boltz_submarine_v2',
      protocol_name: 'Boltz Submarine Swap V2',
      protocol_revision: '2.3.4',
      supported_networks: ['bitcoin', 'liquid'],
      supported_swap_types: ['submarine', 'reverse'],
      taproot_support: true,
      liquid_support: true,
      ark_support: false,
      specification_url: 'https://docs.boltz.exchange/v/submarineswaps',
    },
    {
      protocol_id: 'boltz_chain_v1',
      protocol_name: 'Boltz Chain Swap',
      protocol_revision: '1.2.0',
      supported_networks: ['bitcoin', 'liquid'],
      supported_swap_types: ['chain'],
      taproot_support: true,
      liquid_support: true,
      ark_support: false,
      specification_url: 'https://docs.boltz.exchange/v/chainswaps',
    },
    {
      protocol_id: 'lightning_loop_v1',
      protocol_name: 'Lightning Loop Swap',
      protocol_revision: '0.28.0',
      supported_networks: ['bitcoin'],
      supported_swap_types: ['submarine', 'reverse'],
      taproot_support: true,
      liquid_support: false,
      ark_support: false,
      specification_url: 'https://lightning.engineering/loop/',
    },
    {
      protocol_id: 'ark_vhtlc_v1',
      protocol_name: 'Ark VHTLC Atomic Swap',
      protocol_revision: '0.1.0',
      supported_networks: ['bitcoin'],
      supported_swap_types: ['vhtlc'],
      taproot_support: true,
      liquid_support: false,
      ark_support: true,
      specification_url: 'https://arkdev.info/specs/vhtlc',
    },
  ];

  constructor(private authority: SwapAuthority = new BitcoinSwapAuthority(), private observations: SwapObservationStore = new DatabaseSwapObservations()) {}

  public listProtocols(): SwapProtocolDefinition[] {
    return this.protocols.map(p => ({ ...p, verification_status: 'catalog-only',
      verification_scope: p.protocol_id === 'boltz_submarine_v2'
        ? 'Bitcoin two-leaf Taproot script evidence and unsigned refunds; provider identity and release revision unverified.'
        : 'Protocol-specific proof adapter and owned integration unavailable. Catalog declarations are not verified support.' }));
  }
  public listProviders(): SwapProvider[] { throw new SwapEvidenceError('unavailable-registry', providerRegistryUnavailable); }
  public getProvider(_id: string): SwapProvider | undefined { throw new SwapEvidenceError('unavailable-registry', providerRegistryUnavailable); }
  public getProviderHistory(_id: string): null { throw new SwapEvidenceError('unavailable-registry', providerRegistryUnavailable); }

  /** @asyncSafe Storage failures become explicit unavailable-storage diagnostics. */
  public async getOverview(context = swapContext()): Promise<SwapsOverview> {
    const result: SwapsOverview = { total_swaps_observed: null, active_providers_count: null, total_volume_sats: null,
      supported_protocols_count: 0, recent_swaps: [], active_providers: [], protocols: this.listProtocols(),
      notes: [providerRegistryUnavailable, 'Provider health, settlement volume and provider revision support have no authenticated observation source.'] };
    try {
      result.recent_observations = await this.observations.recent(context);
      result.observation_status = 'historical-observations';
      result.notes!.push('Stored checks describe their recorded checkpoint only. Recheck before recovery; no current spend state is inferred after a restart or reorg.');
    } catch {
      result.observation_status = 'unavailable-storage';
      result.recent_observations = [];
      result.notes!.push('Durable swap observations are unavailable. No totals or health values have been substituted.');
    }
    return result;
  }

  private validatePackage(pkg: Partial<SwapPackage>, context: SwapContext): void {
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new SwapEvidenceError('invalid', 'A public swap package object is required.');
    if (pkg.network !== context.network || (pkg.chain !== undefined && pkg.chain !== context.chain)) throw new SwapEvidenceError('wrong-network', 'Package chain/network must match the selected request context.');
    if (typeof pkg.lockup_transaction !== 'string' || !/^[0-9a-f]{64}$/.test(pkg.lockup_transaction)) throw new SwapEvidenceError('invalid', 'Lockup transaction must be a 32-byte lowercase hexadecimal transaction ID.');
    if (!Number.isSafeInteger(pkg.lockup_vout) || pkg.lockup_vout! < 0 || pkg.lockup_vout! > 0xffffffff) throw new SwapEvidenceError('invalid', 'An explicit lockup output index is required.');
    if (!Number.isSafeInteger(pkg.expected_amount_sats) || pkg.expected_amount_sats! <= 0 || pkg.expected_amount_sats! > 2_100_000_000_000_000) throw new SwapEvidenceError('invalid', 'Expected amount must be a positive integer number of satoshis.');
  }

  private error(err: unknown): { stage: string; message: string } {
    return err instanceof SwapEvidenceError ? { stage: err.code, message: err.message } : { stage: 'invalid', message: 'The supplied transaction or script evidence could not be verified.' };
  }

  /** @asyncSafe Invalid packages and source/storage errors become per-stage diagnostics. */
  private async lockup(pkg: Partial<SwapPackage>, context: SwapContext): Promise<{ evidence?: LockupEvidence; result: SwapLockupVerification }> {
    const result: SwapLockupVerification = { verified: false, script_matches: false, amount_matches: false,
      timeout_valid: false, preimage_hash_committed: false, current_confirmations: 0, required_confirmations: 1, errors: [], stage: 'unverified' };
    try {
      this.validatePackage(pkg, context);
      const contract = boltzContract(pkg, context);
      const evidence = await this.authority.lockup(context, pkg.lockup_transaction!, pkg.lockup_vout!);
      const output = evidence.transaction.outs[pkg.lockup_vout!];
      result.source_context = evidence.context;
      result.lockup_txid = evidence.transaction.getId();
      result.output_index = pkg.lockup_vout;
      result.current_confirmations = evidence.confirmations;
      result.outpoint_unspent = evidence.unspent;
      result.script_matches = !!output && output.script.equals(contract.output);
      result.amount_matches = !!output && output.value === pkg.expected_amount_sats;
      result.preimage_hash_committed = result.script_matches;
      result.timeout_valid = result.script_matches;
      if (!result.script_matches) result.errors.push('Trusted lockup output does not match the protocol script commitment.');
      if (!result.amount_matches) result.errors.push('Trusted lockup output value does not match the expected amount.');
      if (evidence.confirmations < 1) result.errors.push('Lockup is unconfirmed at the selected node checkpoint.');
      result.verified = result.errors.length === 0;
      result.stage = result.verified ? 'lockup-script-verified' : 'invalid';
      try { await this.observations.save(evidence.context, result.lockup_txid, pkg.lockup_vout!, output?.value || 0, result.stage); }
      catch { result.errors.push('Observation persistence unavailable; this response is an on-demand check only.'); }
      return { evidence, result };
    } catch (err) {
      const failure = this.error(err); result.stage = failure.stage; result.errors.push(failure.message);
      return { result };
    }
  }

  /** @asyncSafe Delegates to the lockup error boundary. */
  public async verifyLockup(pkg: Partial<SwapPackage>, context = swapContext()): Promise<SwapLockupVerification> {
    return (await this.lockup(pkg, context)).result;
  }

  /** @asyncSafe Spend failures become per-stage diagnostics. */
  private async spend(pkg: Partial<SwapPackage>, context: SwapContext, refund: boolean, checked?: { evidence?: LockupEvidence; result: SwapLockupVerification }): Promise<any> {
    const result: any = refund
      ? { verified: false, timeout_matured: false, blocks_remaining: null, sequence_valid: false, locktime_valid: false, witness_valid: false, stage: 'unverified', errors: [] }
      : { verified: false, claim_path_valid: false, preimage_matches: false, witness_valid: false, destinations_valid: false, fee_sats: null, stage: 'unverified', errors: [] };
    try {
      const check = checked || await this.lockup(pkg, context);
      if (!check.result.verified || !check.evidence) throw new SwapEvidenceError(check.result.stage!, check.result.errors.join(' '));
      const evidence = check.evidence;
      result.source_context = evidence.context;
      if (refund) {
        result.blocks_remaining = Math.max(0, pkg.timeout_height! - evidence.context.block_height);
        result.timeout_matured = evidence.context.block_height >= pkg.timeout_height!;
      }
      const txid = refund ? pkg.refund_transaction : pkg.claim_transaction;
      if (!txid) throw new SwapEvidenceError('not-observable', 'No actual spending transaction was supplied. Maturity and caller status cannot prove a completed spend.');
      if (!/^[0-9a-f]{64}$/.test(txid)) throw new SwapEvidenceError('invalid', 'Spending transaction ID must be 32-byte lowercase hexadecimal.');
      const spend = await this.authority.transaction(evidence.context, txid);
      if (spend.confirmations < 1) throw new SwapEvidenceError('unconfirmed', 'Spending transaction is not confirmed in the selected active chain.');
      if (refund && !result.timeout_matured) throw new SwapEvidenceError('premature-refund', 'Refund height is not mature at the selected node checkpoint.');
      if (evidence.unspent) throw new SwapEvidenceError('source-disagreement', 'Node still reports this outpoint unspent.');
      const proof = verifyBoltzSpend(pkg, context, evidence.transaction, spend.transaction, refund);
      Object.assign(result, refund
        ? { sequence_valid: true, locktime_valid: true, witness_valid: true }
        : { claim_path_valid: true, preimage_matches: true, witness_valid: true, destinations_valid: true, fee_sats: proof.fee_sats });
      result.verified = true; result.stage = refund ? 'confirmed-refund-verified' : 'confirmed-claim-verified';
    } catch (err) { const failure = this.error(err); result.stage = failure.stage; result.errors.push(failure.message); }
    return result;
  }

  public verifyClaim(pkg: Partial<SwapPackage>, context = swapContext()): Promise<SwapClaimVerification> { return this.spend(pkg, context, false); }
  public verifyRefund(pkg: Partial<SwapPackage>, context = swapContext()): Promise<SwapRefundVerification> { return this.spend(pkg, context, true); }
  /** @asyncSafe Every stage uses its own structured-error boundary. */
  public async verifyReceipts(pkg: Partial<SwapPackage>, context = swapContext()) {
    const checked = await this.lockup(pkg, context);
    const claim = await this.spend(pkg, context, false, checked);
    const refund = await this.spend(pkg, context, true, checked);
    return { lockup: checked.result, claim, refund };
  }

  /** @asyncSafe Source and artifact failures become explicit plan diagnostics. */
  public async planRecovery(pkg: Partial<SwapPackage>, context = swapContext()): Promise<SwapRecoveryPlan> {
    const plan: SwapRecoveryPlan = { swap_id: typeof pkg?.swap_id === 'string' ? pkg.swap_id : '', current_state: 'unknown',
      recommended_action: 'insufficient_artifacts', recoverable_value_sats: 0, estimated_miner_fee_sats: 0,
      timeout_height: Number.isSafeInteger(pkg?.timeout_height) ? pkg.timeout_height! : 0,
      current_block_height: null, blocks_until_refund: null, stage: 'unverified', notes: [] };
    try {
      const { evidence, result } = await this.lockup(pkg, context);
      if (!result.verified || !evidence) throw new SwapEvidenceError(result.stage!, result.errors.join(' '));
      plan.source_context = evidence.context;
      plan.current_block_height = evidence.context.block_height;
      plan.blocks_until_refund = Math.max(0, pkg.timeout_height! - evidence.context.block_height);
      if (!evidence.unspent) throw new SwapEvidenceError('already-spent', 'The trusted outpoint is spent. This does not establish whether it was claimed or refunded.');
      // Validate destination and fee even while waiting, so malformed plans never look usable.
      const artifact = refundPsbt(pkg, context, evidence.transaction);
      plan.recoverable_value_sats = artifact.decoded.output_value_sats;
      plan.estimated_miner_fee_sats = artifact.decoded.fee_sats;
      if (plan.blocks_until_refund > 0) {
        plan.stage = 'not-yet-mature'; plan.recommended_action = 'refundable_after_height';
        plan.notes.push(`Refund can be included after block height ${pkg.timeout_height}. Wait ${plan.blocks_until_refund} blocks.`);
      } else {
        plan.stage = 'unsigned-plan-ready'; plan.recommended_action = 'refundable_now';
        plan.unsigned_recovery_psbt = artifact.encoded; plan.decoded = artifact.decoded;
        plan.notes.push('Unsigned refund plan only. No signature, broadcast or refund completion is implied. Recheck the outpoint and checkpoint before signing.');
      }
      plan.notes.push('Only the Bitcoin two-leaf script contract is checked. Provider identity, release revision, Lightning settlement and cooperative cancellation are unverified.');
      plan.notes.push(...result.errors);
    } catch (err) {
      const failure = this.error(err); plan.stage = failure.stage; plan.notes.push(failure.message);
      if (['already-spent', 'invalid', 'wrong-network', 'reorged'].includes(failure.stage)) plan.recommended_action = 'unsafe';
    }
    return plan;
  }

  public verifyProviderManifest(manifest: Partial<SwapProvider>): { valid: boolean; stage: string; errors: string[] } {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      return { valid: false, stage: 'invalid', errors: ['Manifest must be an object.'] };
    }
    // No signature encoding or key type is authoritative until the owned contract is supplied.
    return { valid: false, stage: 'unavailable-registry', errors: [providerRegistryUnavailable,
      'No protocol-defined signed representation is configured. Signature scheme, exact normalized bytes, domain/network binding, expiry, revision and key rotation remain unverified.'] };
  }

  public reconcileCrossLayer(_swapId: string) {
    return { reconciliation_state: 'insufficient_private_evidence', details: 'No authenticated offchain settlement receipt is available. Public chain evidence cannot establish full cross-layer reconciliation.' };
  }
}

export default new SwapsService();
