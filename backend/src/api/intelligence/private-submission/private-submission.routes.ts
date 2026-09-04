import { Application, Request, Response } from 'express';
import privateSubmissionService from './private-submission.service';

class PrivateSubmissionRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/submission/overview', (_req: Request, res: Response) => {
      try {
        const overview = privateSubmissionService.getOverview();
        res.json(overview);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/submission/capabilities', (_req: Request, res: Response) => {
      try {
        const caps = privateSubmissionService.getCapabilities();
        res.json(caps);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/submission/diagnose', (req: Request, res: Response) => {
      try {
        const rawTx = req.body.raw_tx || req.body.txid || '';
        const diagnosis = privateSubmissionService.diagnoseTransaction(rawTx);
        res.json(diagnosis);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/submission/private', (req: Request, res: Response) => {
      try {
        const record = privateSubmissionService.submitPrivate(req.body);
        res.json(record);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/submission/private/:submissionToken', (req: Request, res: Response) => {
      try {
        const record = privateSubmissionService.getPrivateSubmission(req.params.submissionToken);
        if (!record) {
          return res.status(404).json({ error: 'Submission token not found' });
        }
        res.json(record);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/submission/private/:submissionToken/abort', (req: Request, res: Response) => {
      try {
        const result = privateSubmissionService.abortPrivateSubmission(req.params.submissionToken);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/accelerators/providers', (_req: Request, res: Response) => {
      try {
        const providers = privateSubmissionService.listAcceleratorProviders();
        res.json(providers);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/accelerators/providers/:providerId', (req: Request, res: Response) => {
      try {
        const provider = privateSubmissionService.getAcceleratorProvider(req.params.providerId);
        if (!provider) {
          return res.status(404).json({ error: 'Accelerator provider not found' });
        }
        res.json(provider);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/accelerators/receipts/verify', (req: Request, res: Response) => {
      try {
        const result = privateSubmissionService.verifyAcceleratorReceipt(req.body);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/ordering/transactions/:txid', (req: Request, res: Response) => {
      try {
        const ordering = privateSubmissionService.getTransactionOrdering(req.params.txid);
        if (!ordering) {
          return res.status(404).json({ error: 'Ordering evidence not found for txid' });
        }
        res.json(ordering);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/ordering/blocks/:blockHash', (req: Request, res: Response) => {
      try {
        const ordering = privateSubmissionService.getBlockOrdering(req.params.blockHash);
        res.json(ordering);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/ordering/findings', (_req: Request, res: Response) => {
      try {
        const findings = privateSubmissionService.listOrderingFindings();
        res.json(findings);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });
  }
}

export default new PrivateSubmissionRoutes();
