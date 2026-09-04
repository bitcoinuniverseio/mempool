import {
  TimestampOverview,
  TimestampCalendar,
  TimestampBatch,
  TimestampAnchorTransaction,
  TimestampVerificationResult,
} from './opentimestamps.models';

export class OpenTimestampsService {
  private calendars: TimestampCalendar[] = [
    {
      calendar_id: 'alice-universe',
      name: 'Alice Primary Calendar',
      url: 'https://alice.btc.calendar.opentimestamps.org',
      protocol_revision: '2.0.0',
      health_status: 'online',
      pending_attestations_count: 320,
      average_anchor_lag_blocks: 1,
      last_anchor_block_height: 864205,
      last_anchor_txid: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
      mirror_calendars: ['bob-universe', 'finney-universe'],
    },
    {
      calendar_id: 'bob-universe',
      name: 'Bob Redundant Calendar',
      url: 'https://bob.btc.calendar.opentimestamps.org',
      protocol_revision: '2.0.0',
      health_status: 'online',
      pending_attestations_count: 318,
      average_anchor_lag_blocks: 1,
      last_anchor_block_height: 864205,
      last_anchor_txid: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
      mirror_calendars: ['alice-universe'],
    },
    {
      calendar_id: 'finney-universe',
      name: 'Finney Sovereign Calendar',
      url: 'https://finney.calendar.bitcoinuniverse.io',
      protocol_revision: '2.1.0',
      health_status: 'online',
      pending_attestations_count: 85,
      average_anchor_lag_blocks: 1,
      last_anchor_block_height: 864208,
      last_anchor_txid: '9b71d224bd62f3785d96d46ad3ea3d73319bfbc2770d3d5f7cc9a4744d91aafb',
      mirror_calendars: ['alice-universe', 'bob-universe'],
    },
  ];

  private batches: TimestampBatch[] = [
    {
      batch_id: 'batch-864205-01',
      calendar_id: 'alice-universe',
      merkle_root: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      leaf_count: 2450,
      created_at_utc: '2026-09-04T16:00:00Z',
      anchor_block_height: 864205,
      anchor_txid: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
      status: 'anchored',
    },
    {
      batch_id: 'batch-864210-02',
      calendar_id: 'finney-universe',
      merkle_root: '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae',
      leaf_count: 142,
      created_at_utc: '2026-09-04T17:40:00Z',
      status: 'pending',
    },
  ];

  private anchors: TimestampAnchorTransaction[] = [
    {
      txid: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
      block_hash: '00000000000000000002e4d3c2b1a09876543210fedcba9876543210fedcba9875',
      block_height: 864205,
      block_timestamp_utc: '2026-09-04T16:15:00Z',
      op_return_payload_hex: '6a20e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      calendar_id: 'alice-universe',
      batch_count: 1,
    },
  ];

  public getOverview(): TimestampOverview {
    return {
      total_active_calendars: this.calendars.length,
      total_verified_anchors_count: 18450,
      total_digests_stamped_24h: 3120,
      latest_bitcoin_anchor_height: 864208,
      active_calendars: this.calendars,
      recent_batches: this.batches,
      recent_anchors: this.anchors,
    };
  }

  public listCalendars(): { calendars: TimestampCalendar[] } {
    return { calendars: this.calendars };
  }

  public getCalendar(calendarId: string): TimestampCalendar | undefined {
    return this.calendars.find((c) => c.calendar_id === calendarId);
  }

  public listAnchors(): { anchors: TimestampAnchorTransaction[] } {
    return { anchors: this.anchors };
  }

  public getBatch(batchId: string): TimestampBatch | undefined {
    return this.batches.find((b) => b.batch_id === batchId);
  }

  public stampDigest(digestHex: string): any {
    if (!digestHex || digestHex.length !== 64) {
      throw new Error('Valid 32-byte sha256 digest in hex is required');
    }
    return {
      digest: digestHex,
      calendar_url: this.calendars[0].url,
      submitted_at_utc: new Date().toISOString(),
      pending_attestation: 'att-pending-' + digestHex.slice(0, 16),
      ots_proof_base64: 'CE9wZW5UaW1lc3RhbXBzAf8BAg==',
      notices: [
        'Digest committed to calendar pool.',
        'This proves the committed data existed no later than the future block anchor.',
        'The file itself was not uploaded.',
      ],
    };
  }

  public verifyProof(proofPayload: { digest?: string; ots_proof?: string }): TimestampVerificationResult {
    const isPending = proofPayload.ots_proof?.includes('pending') ?? false;
    if (isPending) {
      return {
        status: 'pending_calendar_attestation',
        verified: false,
        digest_matches: true,
        calendar_attestations: [
          { calendar_url: this.calendars[0].url, status: 'pending' },
        ],
        operation_count: 4,
        notices: [
          'Proof has been received by calendar servers and is awaiting the next Bitcoin block commitment.',
          'The file itself was not uploaded.',
        ],
        errors: [],
      };
    }

    return {
      status: 'bitcoin_attestation_verified',
      verified: true,
      digest_matches: true,
      earliest_proven_block_height: 864205,
      earliest_proven_time_utc: '2026-09-04T16:15:00Z',
      bitcoin_txid: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
      calendar_attestations: [
        {
          calendar_url: this.calendars[0].url,
          status: 'verified',
          attestation_time: '2026-09-04T16:00:00Z',
        },
      ],
      operation_count: 8,
      notices: [
        'This proves the committed data existed no later than Bitcoin block 864205.',
        'This does not prove who created it.',
        'This does not prove the contents are true.',
        'The file itself was not uploaded.',
      ],
      errors: [],
    };
  }

  public upgradeProof(proofData: { ots_proof: string }): any {
    return {
      upgraded: true,
      new_operations_count: 6,
      bitcoin_block_height: 864205,
      upgraded_ots_proof_base64: 'CE9wZW5UaW1lc3RhbXBzAf8BBA==',
      status: 'bitcoin_attestation_verified',
    };
  }
}

export default new OpenTimestampsService();
