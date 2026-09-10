import { Application, Request, Response } from 'express';
import { VerificationEvidenceError, verificationService } from './verification.service';
import { handleError } from '../../../utils/api';

/** An absent source is a 503 that names the source, never a 500 and never an invented verdict. */
function fail(req: Request, res: Response, e: unknown, fallback: string): void {
  if (e instanceof VerificationEvidenceError) {
    res.status(e.status).json({ stage: e.code, error: e.message });
    return;
  }
  handleError(req, res, 500, e instanceof Error ? e.message : fallback);
}

class VerificationRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/verification/';
    const incPrefix = '/api/v1/intelligence/incidents';

    app
      .post(prefix + 'spv-proof', this.$postSpvProof)
      .post(prefix + 'verify-spv', this.$postVerifySpv)
      .post(prefix + 'compact-filter', this.$postCompactFilter)
      .post(prefix + 'verify-signature', this.$postVerifySignature)
      .get(incPrefix, this.$getIncidents)
      .get(incPrefix + '/:id', this.$getIncident);
  }

  private async $postSpvProof(req: Request, res: Response): Promise<void> {
    try {
      const { txid, block_hash, block_height } = req.body;
      if (!txid || !block_hash) {
        res.status(400).json({ error: 'txid and block_hash parameters required.' });
        return;
      }
      const proof = verificationService.generateSpvProof(txid, block_hash, block_height);
      res.json(proof);
    } catch (e) {
      fail(req, res, e, 'SPV proof generation failed');
    }
  }

  private async $postVerifySpv(req: Request, res: Response): Promise<void> {
    try {
      const proof = req.body.proof || req.body;
      const valid = verificationService.verifySpvProof(proof);
      res.json({ is_valid: valid, verified_at_utc: new Date().toISOString() });
    } catch (e) {
      fail(req, res, e, 'SPV verification failed');
    }
  }

  private async $postCompactFilter(req: Request, res: Response): Promise<void> {
    try {
      const { block_hash, scripts } = req.body;
      if (!block_hash || !Array.isArray(scripts)) {
        res.status(400).json({ error: 'block_hash and array of scripts required.' });
        return;
      }
      const filterResult = verificationService.queryCompactFilter(block_hash, scripts);
      res.json(filterResult);
    } catch (e) {
      fail(req, res, e, 'Compact filter query failed');
    }
  }

  private async $postVerifySignature(req: Request, res: Response): Promise<void> {
    try {
      const { address, message, signature, format } = req.body;
      if (!address || !message || !signature) {
        res.status(400).json({ error: 'address, message, and signature required.' });
        return;
      }
      const result = verificationService.verifySignature(address, message, signature, format);
      res.json(result);
    } catch (e) {
      fail(req, res, e, 'Signature verification failed');
    }
  }

  private async $getIncidents(req: Request, res: Response): Promise<void> {
    try {
      const incidents = verificationService.getIncidents();
      res.json({ incidents, count: incidents.length });
    } catch (e) {
      fail(req, res, e, 'Failed to fetch incidents');
    }
  }

  private async $getIncident(req: Request, res: Response): Promise<void> {
    try {
      const incident = verificationService.getIncidentById(req.params.id);
      if (!incident) {
        res.status(404).json({ error: `Incident '${req.params.id}' not found.` });
        return;
      }
      res.json(incident);
    } catch (e) {
      fail(req, res, e, 'Failed to fetch incident');
    }
  }
}

export default new VerificationRoutes();
