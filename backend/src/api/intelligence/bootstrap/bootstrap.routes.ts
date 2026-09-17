import { Application, Request, Response } from 'express';
import {
  adminAdapterGuard,
  adminAdapterJsonParser,
} from '../../admin-adapter/admin-adapter.security';
import bootstrapService, { BootstrapEvidenceError } from './bootstrap.service';

function fail(res: Response, err: unknown): Response {
  if (err instanceof BootstrapEvidenceError)
    return res.status(err.status).json({ stage: err.code, error: err.message });
  return res.status(500).json({ error: 'Internal error' });
}

/**
 * Operator routes reuse the control plane's own trust: a private-path origin
 * and a signed request verified by the admin adapter guard, mounted here so
 * it runs before any handler. The signature covers the exact request bytes;
 * the adapter parser captures them, so this prefix is mounted before the
 * general JSON parser in index.ts (see the /internal/admin/v1 line).
 */
export const OPERATOR_PREFIX = '/api/v1/intelligence/bootstrap/operator';

class BootstrapRoutes {
  public initRoutes(app: Application): void {
    app.use(OPERATOR_PREFIX, adminAdapterJsonParser(), adminAdapterGuard());
    bootstrapService.startWorker();

    app.get(
      '/api/v1/intelligence/bootstrap/overview',
      async (req: Request, res: Response) => {
        try {
          const overview = await bootstrapService.getOverview();
          res.json(overview);
        } catch (err: any) {
          fail(res, err);
        }
      }
    );

    app.get(
      '/api/v1/intelligence/bootstrap/nodes',
      async (req: Request, res: Response) => {
        try {
          const nodes = await bootstrapService.listNodes();
          res.json(nodes);
        } catch (err: any) {
          fail(res, err);
        }
      }
    );

    // Every observed node, which is what the chainstates page asks for. It
    // was calling this path already; only the per-node read existed, so the
    // page received a 404 and rendered nothing.
    app.get(
      '/api/v1/intelligence/bootstrap/chainstates',
      async (_req: Request, res: Response) => {
        try {
          res.json(await bootstrapService.listNodeChainstates());
        } catch (err: any) {
          fail(res, err);
        }
      }
    );

    app.get(
      '/api/v1/intelligence/bootstrap/nodes/:nodeId/chainstates',
      async (req: Request, res: Response) => {
        try {
          const chainstates = await bootstrapService.getNodeChainstates(
            req.params.nodeId
          );
          if (!chainstates) {
            return res
              .status(404)
              .json({ error: 'Chainstates observation not found for node' });
          }
          res.json(chainstates);
        } catch (err: any) {
          fail(res, err);
        }
      }
    );

    app.get(
      '/api/v1/intelligence/bootstrap/snapshots',
      async (req: Request, res: Response) => {
        try {
          const snapshots = await bootstrapService.listSnapshots();
          res.json(snapshots);
        } catch (err: any) {
          fail(res, err);
        }
      }
    );

    app.get(
      '/api/v1/intelligence/bootstrap/snapshots/:snapshotId',
      async (req: Request, res: Response) => {
        try {
          const snapshot = await bootstrapService.getSnapshot(req.params.snapshotId);
          if (!snapshot) {
            return res.status(404).json({ error: 'Snapshot not found' });
          }
          res.json(snapshot);
        } catch (err: any) {
          fail(res, err);
        }
      }
    );

    app.get(
      '/api/v1/intelligence/bootstrap/snapshots/:snapshotId/manifest',
      async (req: Request, res: Response) => {
        try {
          const manifest = bootstrapService.getSnapshotManifest(req.params.snapshotId);
          if (!manifest) {
            return res.status(404).json({ error: 'Manifest not found' });
          }
          res.json(manifest);
        } catch (err: any) {
          fail(res, err);
        }
      }
    );

    app.post(
      '/api/v1/intelligence/bootstrap/verifications',
      async (req: Request, res: Response) => {
        try {
          const verification = await bootstrapService.verifySnapshot(req.body);
          res.status(verification.state === 'pending' || verification.state === 'verifying' ? 202 : 200).json(verification);
        } catch (err: any) {
          fail(res, err);
        }
      }
    );

    app.get(
      '/api/v1/intelligence/bootstrap/verifications/:verificationId',
      async (req: Request, res: Response) => {
        try {
          const verification = await bootstrapService.getVerification(
            req.params.verificationId
          );
          if (!verification) {
            return res
              .status(404)
              .json({ error: 'Verification run not found' });
          }
          res.json(verification);
        } catch (err: any) {
          fail(res, err);
        }
      }
    );

    app.post(
      '/api/v1/intelligence/bootstrap/plans',
      async (req: Request, res: Response) => {
        try {
          const plan = await bootstrapService.createBootstrapPlan(req.body);
          res.json(plan);
        } catch (err: any) {
          fail(res, err);
        }
      }
    );

    app.post(
      `${OPERATOR_PREFIX}/snapshots`,
      async (req: Request, res: Response) => {
        try {
          const job = await bootstrapService.createOperatorJob(
            {
              job_type: 'generate_snapshot',
              node_id: req.body?.node_id,
              idempotency_key: req.body?.idempotency_key,
            },
            res.locals.adminAdapterAuthorization
          );
          res.status(202).json(job);
        } catch (err: any) {
          fail(res, err);
        }
      }
    );

    app.post(
      `${OPERATOR_PREFIX}/loads`,
      async (req: Request, res: Response) => {
        try {
          const job = await bootstrapService.createOperatorJob(
            {
              job_type: 'load_snapshot',
              node_id: req.body?.node_id,
              snapshot_id: req.body?.snapshot_id,
              idempotency_key: req.body?.idempotency_key,
              confirm: req.body?.confirm,
            },
            res.locals.adminAdapterAuthorization
          );
          res.status(202).json(job);
        } catch (err: any) {
          fail(res, err);
        }
      }
    );

    app.get(
      '/api/v1/intelligence/bootstrap/jobs/:jobId',
      async (req: Request, res: Response) => {
        try {
          const job = await bootstrapService.getJob(req.params.jobId);
          if (!job) {
            return res.status(404).json({ error: 'Job not found' });
          }
          res.json(job);
        } catch (err: any) {
          fail(res, err);
        }
      }
    );
  }
}

export default new BootstrapRoutes();
