import { Application, Request, Response } from 'express';
import simplicityService, { SimplicityEvidenceError } from './simplicity.service';

/** An absent source is a 503 that names the source, never a 500 and never an empty list. */
function fail(res: Response, err: unknown, status = 500): Response {
  if (err instanceof SimplicityEvidenceError) return res.status(err.status).json({ stage: err.code, error: err.message });
  return res.status(status).json({ error: err instanceof Error && err.message ? err.message : 'Internal error' });
}

class SimplicityRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/simplicity/overview', (req: Request, res: Response) => {
      try {
        const overview = simplicityService.getOverview();
        res.json(overview);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/simplicity/programs', (req: Request, res: Response) => {
      try {
        const progs = simplicityService.listPrograms();
        res.json(progs);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/simplicity/programs/:programId', (req: Request, res: Response) => {
      try {
        const prog = simplicityService.getProgram(req.params.programId);
        if (!prog) {
          return res.status(404).json({ error: 'Program not found' });
        }
        res.json(prog);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/simplicity/programs/:programId/occurrences', (req: Request, res: Response) => {
      try {
        const occurrences = simplicityService.getProgramOccurrences(req.params.programId);
        res.json(occurrences);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/simplicity/transactions/:txid', (req: Request, res: Response) => {
      try {
        const tx = simplicityService.getTransaction(req.params.txid);
        res.json(tx);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/simplicity/toolchains', (req: Request, res: Response) => {
      try {
        const toolchains = simplicityService.listToolchains();
        res.json(toolchains);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.post('/api/v1/intelligence/simplicity/programs/decode', (req: Request, res: Response) => {
      try {
        const bytesHex = req.body.program_bytes_hex || req.body.bytes;
        const decoded = simplicityService.decodeProgram(bytesHex);
        res.json(decoded);
      } catch (err: any) {
        fail(res, err, 400);
      }
    });

    app.post('/api/v1/intelligence/simplicity/programs/execute', (req: Request, res: Response) => {
      try {
        const result = simplicityService.executeProgram(req.body);
        res.json(result);
      } catch (err: any) {
        fail(res, err, 400);
      }
    });

    app.post('/api/v1/intelligence/simplicity/formal-artifacts/verify', (req: Request, res: Response) => {
      try {
        const result = simplicityService.verifyFormalArtifact(req.body);
        res.json(result);
      } catch (err: any) {
        fail(res, err, 400);
      }
    });
  }
}

export default new SimplicityRoutes();
