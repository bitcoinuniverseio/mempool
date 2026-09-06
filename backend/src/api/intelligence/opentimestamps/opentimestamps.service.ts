import {
  TimestampOverview, TimestampCalendar, TimestampBatch, TimestampAnchorTransaction, TimestampVerificationResult,
} from './opentimestamps.models';
import config from '../../../config';
import { TimestampEvidenceError } from './opentimestamps-errors';
import { TimestampBitcoinReader, TimestampProofRequest, verifyDetachedProof } from './opentimestamps-proof';
export { TimestampEvidenceError } from './opentimestamps-errors';

const unavailable = (code: string, prerequisite: string): never => {
  throw new TimestampEvidenceError(code, 'Timestamp evidence is unavailable. ' + prerequisite);
};

export class OpenTimestampsService {
  constructor(private readonly options: { reader?: TimestampBitcoinReader; network?: string } = {}) {}
  public getOverview(): TimestampOverview {
    return unavailable('unavailable-calendar-source', 'The owned calendar, batch and Bitcoin anchor sources are not connected.');
  }

  public listCalendars(): { calendars: TimestampCalendar[] } {
    return unavailable('unavailable-calendar-source', 'No owned calendar directory or health observation source is connected.');
  }

  public getCalendar(_calendarId: string): TimestampCalendar | undefined {
    return unavailable('unavailable-calendar-source', 'No owned calendar directory or health observation source is connected.');
  }

  public listAnchors(): { anchors: TimestampAnchorTransaction[] } {
    return unavailable('unavailable-anchor-source', 'No owned Bitcoin anchor reader is connected.');
  }

  public getBatch(_batchId: string): TimestampBatch | undefined {
    return unavailable('unavailable-calendar-source', 'No owned calendar batch reader is connected.');
  }

  public stampDigest(digestHex: string): never {
    if (typeof digestHex !== 'string' || !/^[0-9a-f]{64}$/i.test(digestHex)) {
      throw new TimestampEvidenceError('invalid-input', 'A 32-byte SHA256 digest in hexadecimal is required.', 400);
    }
    return unavailable('unavailable-calendar', 'An owned calendar submission client and its actual returned attestation are required. No digest was submitted and no proof was created.');
  }

  public async verifyProof(proofPayload: TimestampProofRequest): Promise<TimestampVerificationResult> {
    this.requireProof(proofPayload);
    const reader = this.options.reader ?? {
      $getBlockHash: (height: number) => import('../../bitcoin/bitcoin-api-factory').then(module => module.default.$getBlockHash(height)),
      $getBlockHeader: (hash: string) => import('../../bitcoin/bitcoin-api-factory').then(module => module.default.$getBlockHeader(hash)),
    };
    return verifyDetachedProof(proofPayload, reader, this.options.network ?? config.MEMPOOL.NETWORK);
  }

  public upgradeProof(proofData: { ots_proof?: string; proof?: string }): never {
    this.requireProof(proofData);
    return unavailable('unavailable-calendar', 'Proof upgrade requires an actual owned calendar response and validation of the returned proof. No proof was upgraded.');
  }

  private requireProof(value: { ots_proof?: string; proof?: string }): void {
    const proof = value?.ots_proof ?? value?.proof;
    if (typeof proof !== 'string' || proof.trim().length === 0) {
      throw new TimestampEvidenceError('invalid-input', 'A nonempty .ots proof is required.', 400);
    }
  }
}

export default new OpenTimestampsService();
