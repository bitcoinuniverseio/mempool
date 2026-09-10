import * as crypto from 'crypto';
import {
  BitcoinStakingOverview,
  CrossChainReconciliationResult,
  EotsSlashingEvidence,
  FinalityProvider,
  StakingDelegation,
  StakingDelegationState,
  StakingProtocolParameters,
  StakingTransactionVerificationRequest,
  StakingTransactionVerificationResult,
} from './bitcoin-staking.models';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class BitcoinStakingEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const indexerUnavailable =
  'Bitcoin staking observations are unavailable. Delegation, finality provider, slashing evidence and overview reads require the owned Babylon staking indexer over the owned Bitcoin reader, which are not connected on this deployment.';

const parametersUnavailable =
  'Bitcoin staking parameters are unavailable. Parameter reads require the owned copy of the Babylon global staking parameters (covenant keys, timelocks and amount bounds per version), which is not connected on this deployment.';

const parserUnavailable =
  'Bitcoin staking transaction verification is unavailable. Classifying a transaction requires the owned Babylon staking script parser and the owned parameter source, which are not connected on this deployment.';

const consumerChainUnavailable =
  'Cross-chain reconciliation is unavailable. Reconciling Bitcoin stake with consumer voting power requires the owned Babylon consumer chain reader and the owned staking indexer, which are not connected on this deployment.';

/**
 * Bitcoin staking (Babylon) evidence.
 *
 * Delegations, finality providers, slashing evidence and the parameter table
 * come from the owned staking indexer and parameter source. A deployment that
 * has neither gets a 503 that names them: an empty delegation directory and an
 * absent one are different answers, and this never turns the second into the
 * first. EOTS evidence checks are computations on caller-supplied input and
 * stay answerable.
 */
export class BitcoinStakingService {
  public getOverview(): BitcoinStakingOverview {
    throw new BitcoinStakingEvidenceError('unavailable-staking-indexer', indexerUnavailable);
  }

  public getParameters(): StakingProtocolParameters[] {
    throw new BitcoinStakingEvidenceError('unavailable-staking-parameters', parametersUnavailable);
  }

  public getParameter(_versionId: string): StakingProtocolParameters | undefined {
    throw new BitcoinStakingEvidenceError('unavailable-staking-parameters', parametersUnavailable);
  }

  public listDelegations(_stateFilter?: StakingDelegationState): StakingDelegation[] {
    throw new BitcoinStakingEvidenceError('unavailable-staking-indexer', indexerUnavailable);
  }

  public getDelegation(_delegationId: string): StakingDelegation | undefined {
    throw new BitcoinStakingEvidenceError('unavailable-staking-indexer', indexerUnavailable);
  }

  public listFinalityProviders(): FinalityProvider[] {
    throw new BitcoinStakingEvidenceError('unavailable-staking-indexer', indexerUnavailable);
  }

  public getFinalityProvider(_providerId: string): FinalityProvider | undefined {
    throw new BitcoinStakingEvidenceError('unavailable-staking-indexer', indexerUnavailable);
  }

  public listEvidence(): EotsSlashingEvidence[] {
    throw new BitcoinStakingEvidenceError('unavailable-staking-indexer', indexerUnavailable);
  }

  public verifyTransaction(request: StakingTransactionVerificationRequest): StakingTransactionVerificationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!request || !request.raw_tx_hex || typeof request.raw_tx_hex !== 'string') {
      errors.push('Raw transaction hex string is required');
      return {
        valid: false,
        txid: '',
        family: 'unknown',
        detected_parameters: {},
        errors,
        warnings,
      };
    }

    if (!/^[0-9a-fA-F]+$/.test(request.raw_tx_hex) || request.raw_tx_hex.length < 120) {
      errors.push('Transaction hex is malformed or too short');
      return {
        valid: false,
        txid: '',
        family: 'unknown',
        detected_parameters: {},
        errors,
        warnings,
      };
    }

    throw new BitcoinStakingEvidenceError('unavailable-staking-parser', parserUnavailable);
  }

  public verifySlashingEvidence(evidence: {
    eots_pk: string;
    nonce_point: string;
    message_a: string;
    message_b: string;
    signature_a: string;
    signature_b: string;
  }): {
    verified: boolean;
    status: 'equivocation_proven' | 'suspected_conflict' | 'invalid_evidence' | 'insufficient_evidence';
    reason: string;
    recovered_secret_hash?: string;
  } {
    if (!evidence.eots_pk || !evidence.nonce_point || !evidence.message_a || !evidence.message_b) {
      return {
        verified: false,
        status: 'insufficient_evidence',
        reason: 'Missing public key, nonce commitment, or signed messages',
      };
    }

    if (evidence.message_a === evidence.message_b) {
      return {
        verified: false,
        status: 'invalid_evidence',
        reason: 'Equivocation proof requires two distinct messages for the same nonce point',
      };
    }

    if (!evidence.signature_a || !evidence.signature_b) {
      return {
        verified: false,
        status: 'insufficient_evidence',
        reason: 'Dual signatures are required to extract private key scalar under EOTS',
      };
    }

    // Two distinct messages with two signatures are the shape of an equivocation,
    // not a proof of one: proving it means checking both Schnorr signatures under
    // the same nonce point and extracting the scalar, which needs the owned EOTS
    // verifier. A sha256 over the inputs proves nothing.
    throw new BitcoinStakingEvidenceError('unavailable-eots-verifier',
      'EOTS equivocation evidence is not verified on this deployment. Checking both signatures against the finality provider key and nonce point and extracting the secret scalar requires the owned EOTS verifier, which is not connected.');
  }

  public reconcileWithConsumerPoS(_chainName: string): CrossChainReconciliationResult {
    throw new BitcoinStakingEvidenceError('unavailable-consumer-chain', consumerChainUnavailable);
  }
}

export default new BitcoinStakingService();
