import { Application, Request, Response } from 'express';
import bootstrapService from './bootstrap.service';

class BootstrapRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/bootstrap/overview', (req: Request, res: Response) => {
      try {
        const overview = bootstrapService.getOverview();
        res.json(overview);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/bootstrap/nodes', (req: Request, res: Response) => {
      try {
        const nodes = bootstrapService.listNodes();
        res.json(nodes);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/bootstrap/nodes/:nodeId/chainstates', (req: Request, res: Response) => {
      try {
        const chainstates = bootstrapService.getNodeChainstates(req.params.nodeId);
        if (!chainstates) {
          return res.status(404).json({ error: 'Chainstates observation not found for node' });
        }
        res.json(chainstates);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/bootstrap/snapshots', (req: Request, res: Response) => {
      try {
        const snapshots = bootstrapService.listSnapshots();
        res.json(snapshots);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/bootstrap/snapshots/:snapshotId', (req: Request, res: Response) => {
      try {
        const snapshot = bootstrapService.getSnapshot(req.params.snapshotId);
        if (!snapshot) {
          return res.status(404).json({ error: 'Snapshot not found' });
        }
        res.json(snapshot);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/bootstrap/snapshots/:snapshotId/manifest', (req: Request, res: Response) => {
      try {
        const snapshot = bootstrapService.getSnapshot(req.params.snapshotId);
        if (!snapshot || !snapshot.manifest) {
          return res.status(404).json({ error: 'Manifest not found' });
        }
        res.json(snapshot.manifest);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/bootstrap/verifications', (req: Request, res: Response) => {
      try {
        const verification = bootstrapService.verifySnapshot(req.body);
        res.json(verification);
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Verification error' });
      }
    });

    app.get('/api/v1/intelligence/bootstrap/verifications/:verificationId', (req: Request, res: Response) => {
      try {
        const verification = bootstrapService.getVerification(req.params.verificationId);
        if (!verification) {
          return res.status(404).json({ error: 'Verification run not found' });
        }
        res.json(verification);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/bootstrap/plans', (req: Request, res: Response) => {
      try {
        const plan = bootstrapService.createBootstrapPlan(req.body);
        res.json(plan);
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Plan generation failed' });
      }
    });

    app.post('/api/v1/intelligence/bootstrap/operator/snapshots', (req: Request, res: Response) => {
      try {
        const job = bootstrapService.createOperatorJob({
          job_type: 'generate_snapshot',
          node_id: req.body.node_id,
        });
        res.json(job);
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Snapshot generation job failed' });
      }
    });

    app.post('/api/v1/intelligence/bootstrap/operator/loads', (req: Request, res: Response) => {
      try {
        const job = bootstrapService.createOperatorJob({
          job_type: 'load_snapshot',
          node_id: req.body.node_id,
          snapshot_id: req.body.snapshot_id,
        });
        res.json(job);
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Snapshot load job failed' });
      }
    });

    app.get('/api/v1/intelligence/bootstrap/jobs/:jobId', (req: Request, res: Response) => {
      try {
        const job = bootstrapService.getJob(req.params.jobId);
        if (!job) {
          return res.status(404).json({ error: 'Job not found' });
        }
        res.json(job);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });
  }
}

export default new BootstrapRoutes();
