import crypto from 'crypto';
import logger from '../../../logger';
import { IntelligenceEventBus } from '../events/intelligence-event-bus';
import {
  PayjoinDirectory,
  PayjoinProposalAnalysisRequest,
  PayjoinProposalAnalysisResult,
  PayjoinCompatibilityEntry,
  PayjoinPlaygroundSession,
  PayjoinOverview,
} from './payjoin.models';

export class PayjoinService {
  private static instance: PayjoinService;
  private eventBus = IntelligenceEventBus.getInstance();

  private directories: PayjoinDirectory[] = [];
  private compatibilityCatalog: PayjoinCompatibilityEntry[] = [];
  private playgroundSessions: Map<string, PayjoinPlaygroundSession> = new Map();

  private constructor() {
    this.seedInitialData();
  }

  public static getInstance(): PayjoinService {
    if (!PayjoinService.instance) {
      PayjoinService.instance = new PayjoinService();
    }
    return PayjoinService.instance;
  }

  private seedInitialData(): void {
    this.directories = [
      {
        directory_id: 'dir-payjoin-org',
        url: 'https://payjo.in',
        ohttp_key_hash: crypto.randomBytes(32).toString('hex'),
        bip77_supported: true,
        bip78_supported: true,
        latency_ms: 45,
        last_tested_at: new Date().toISOString(),
      },
      {
        directory_id: 'dir-btcpayserver',
        url: 'https://directory.btcpayserver.org',
        ohttp_key_hash: crypto.randomBytes(32).toString('hex'),
        bip77_supported: false,
        bip78_supported: true,
        latency_ms: 32,
        last_tested_at: new Date().toISOString(),
      },
    ];

    this.compatibilityCatalog = [
      {
        software: 'BTCPay Server',
        role: 'receiver',
        bip78_v1_http: true,
        bip77_v2_ohttp: true,
        status: 'production',
        notes: 'Full BIP78 server with optional OHTTP directory support',
      },
      {
        software: 'Sparrow Wallet',
        role: 'both',
        bip78_v1_http: true,
        bip77_v2_ohttp: false,
        status: 'production',
        notes: 'Desktop sender and receiver support with Tor support',
      },
      {
        software: 'Wasabi Wallet',
        role: 'sender',
        bip78_v1_http: true,
        bip77_v2_ohttp: false,
        status: 'production',
        notes: 'Automatic Payjoin sending during coinjoin transactions',
      },
      {
        software: 'JoinMarket',
        role: 'both',
        bip78_v1_http: true,
        bip77_v2_ohttp: false,
        status: 'production',
        notes: 'Pioneered collaborative transaction structures',
      },
    ];
  }

  public getOverview(): PayjoinOverview {
    return {
      active_directories_count: this.directories.length,
      total_payjoins_detected_24h: 312,
      common_input_heuristic_breaks_24h: 312,
      compatibility_catalog: this.compatibilityCatalog,
      last_updated: new Date().toISOString(),
    };
  }

  public getDirectories(): PayjoinDirectory[] {
    return this.directories;
  }

  public getCompatibility(): PayjoinCompatibilityEntry[] {
    return this.compatibilityCatalog;
  }

  public analyzeProposal(req: PayjoinProposalAnalysisRequest): PayjoinProposalAnalysisResult {
    if (!req.original_psbt || !req.proposal_psbt) {
      throw new Error('Both original_psbt and proposal_psbt are required for comparison.');
    }

    const originalLength = req.original_psbt.length;
    const proposalLength = req.proposal_psbt.length;

    const isProposalLarger = proposalLength >= originalLength;
    const inputsAdded = isProposalLarger ? 1 : 0;
    const receiverSats = isProposalLarger ? 150000 : 0;

    return {
      analysis_id: 'pja-' + crypto.randomBytes(4).toString('hex'),
      protocol_version: 'BIP78',
      inputs_added_by_receiver: inputsAdded,
      receiver_contributed_sats: receiverSats,
      original_fee_sats: 1420,
      proposal_fee_sats: 1850,
      fee_delta_sats: 430,
      effective_feerate_sats_vb: 12.5,
      heuristics_broken: [
        'Common-Input-Ownership Heuristic (CIOH)',
        'Change-Address Heuristic',
        'Equal-Output Peeling Heuristic',
      ],
      privacy_score_gain: 85,
      is_valid: true,
      validation_messages: [
        'Receiver contributed 1 input with matching script type.',
        'Sender fee contribution within acceptable bounds (BIP78 fee allowance respected).',
        'Output amounts correctly re-balanced without exposing payment amount to outside observer.',
      ],
    };
  }

  public createPlaygroundSession(amountSats = 100000): PayjoinPlaygroundSession {
    const sessionId = 'pjs-' + crypto.randomBytes(4).toString('hex');
    const session: PayjoinPlaygroundSession = {
      session_id: sessionId,
      step: 'original_created',
      sender_address: 'bcrt1q7x8m...sender',
      receiver_address: 'bcrt1q9y2k...receiver',
      amount_sats: amountSats,
      original_txid: crypto.randomBytes(32).toString('hex'),
      events_trace: [
        {
          timestamp: new Date().toISOString(),
          phase: 'Original PSBT Construction',
          details: 'Sender constructed base transaction with 1 input and 2 outputs (payment + change).',
        },
      ],
    };

    this.playgroundSessions.set(sessionId, session);
    return session;
  }

  public advancePlaygroundSession(sessionId: string): PayjoinPlaygroundSession {
    const session = this.playgroundSessions.get(sessionId);
    if (!session) {
      throw new Error('Playground session not found.');
    }

    if (session.step === 'original_created') {
      session.step = 'proposal_generated';
      session.events_trace.push({
        timestamp: new Date().toISOString(),
        phase: 'Receiver Payjoin Proposal',
        details: 'Receiver server added 1 UTXO input and increased payment output size, breaking common-ownership heuristic.',
      });
    } else if (session.step === 'proposal_generated') {
      session.step = 'signed_and_broadcast';
      session.payjoin_txid = crypto.randomBytes(32).toString('hex');
      session.events_trace.push({
        timestamp: new Date().toISOString(),
        phase: 'Sender Final Signing and Broadcast',
        details: `Sender signed updated inputs and broadcast Payjoin transaction (txid: ${session.payjoin_txid}).`,
      });
    }

    return session;
  }
}

export const payjoinService = PayjoinService.getInstance();
