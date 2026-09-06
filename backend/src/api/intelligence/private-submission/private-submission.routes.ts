import { Application, Request, Response } from 'express';
import privateSubmissionService, { SubmissionEvidenceError } from './private-submission.service';

/**
 * Turns an absent integration into a 503 that names it, and anything else into
 * a 500. A read with no source behind it is a service state, not a result, so
 * it never reaches a caller as a 200 body.
 */
function fail(res: Response, err: unknown): Response {
  if (err instanceof SubmissionEvidenceError) {
    return res.status(503).json({ stage: err.code, error: err.message });
  }
  return res.status(500).json({ error: (err as Error)?.message || 'Internal error' });
}

class PrivateSubmissionRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/submission/overview', (_req: Request, res: Response) => {
      try {
        res.json(privateSubmissionService.getOverview());
      } catch (err) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/submission/capabilities', (_req: Request, res: Response) => {
      try {
        res.json(privateSubmissionService.getCapabilities());
      } catch (err) {
        fail(res, err);
      }
    });

    app.post('/api/v1/intelligence/submission/diagnose', (req: Request, res: Response) => {
      try {
        const rawTx = req.body.raw_tx || req.body.txid || '';
        res.json(privateSubmissionService.diagnoseTransaction(rawTx));
      } catch (err) {
        fail(res, err);
      }
    });

    app.post('/api/v1/intelligence/submission/private', (req: Request, res: Response) => {
      try {
        res.json(privateSubmissionService.submitPrivate(req.body));
      } catch (err) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/submission/private/:submissionToken', (req: Request, res: Response) => {
      try {
        res.json(privateSubmissionService.getPrivateSubmission(req.params.submissionToken));
      } catch (err) {
        fail(res, err);
      }
    });

    app.post('/api/v1/intelligence/submission/private/:submissionToken/abort', (req: Request, res: Response) => {
      try {
        res.json(privateSubmissionService.abortPrivateSubmission(req.params.submissionToken));
      } catch (err) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/accelerators/providers', (_req: Request, res: Response) => {
      try {
        res.json(privateSubmissionService.listAcceleratorProviders());
      } catch (err) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/accelerators/providers/:providerId', (req: Request, res: Response) => {
      try {
        res.json(privateSubmissionService.getAcceleratorProvider(req.params.providerId));
      } catch (err) {
        fail(res, err);
      }
    });

    // The one route here that can still answer, because it reads the caller's
    // own payload. A malformed receipt is the caller's 400; a complete one
    // cannot be verified without the registry, which is a 503.
    app.post('/api/v1/intelligence/accelerators/receipts/verify', (req: Request, res: Response) => {
      try {
        const result = privateSubmissionService.verifyAcceleratorReceipt(req.body || {});
        res.status(result.stage === 'invalid' ? 400 : 503).json(result);
      } catch (err) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/ordering/transactions/:txid', (req: Request, res: Response) => {
      try {
        res.json(privateSubmissionService.getTransactionOrdering(req.params.txid));
      } catch (err) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/ordering/blocks/:blockHash', (req: Request, res: Response) => {
      try {
        res.json(privateSubmissionService.getBlockOrdering(req.params.blockHash));
      } catch (err) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/ordering/findings', (_req: Request, res: Response) => {
      try {
        res.json(privateSubmissionService.listOrderingFindings());
      } catch (err) {
        fail(res, err);
      }
    });
  }
}

export default new PrivateSubmissionRoutes();
