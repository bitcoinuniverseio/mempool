import {
  TimestampOverview, TimestampCalendar, TimestampBatch, TimestampAnchorTransaction, TimestampVerificationResult,
} from './opentimestamps.models';

export class TimestampEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const unavailable = (code: string, prerequisite: string): never => {
  throw new TimestampEvidenceError(code, 'Timestamp evidence is unavailable. ' + prerequisite);
};

export class OpenTimestampsService {
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

  public verifyProof(proofPayload: { digest?: string; ots_proof?: string; proof?: string }): TimestampVerificationResult {
    this.requireProof(proofPayload);
    if (proofPayload.digest !== undefined && (typeof proofPayload.digest !== 'string' || !/^[0-9a-f]{64}$/i.test(proofPayload.digest))) {
      throw new TimestampEvidenceError('invalid-input', 'A 32-byte SHA256 digest in hexadecimal is required.', 400);
    }
    return unavailable('unavailable-proof-verifier', 'The .ots operation/attestation verifier and owned Bitcoin header reader are not connected. No digest match, calendar receipt or Bitcoin commitment was verified.');
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
