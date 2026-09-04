import { Application, Request, Response } from 'express';
import simplicityService from './simplicity.service';

class SimplicityRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/simplicity/overview', (req: Request, res: Response) => {
      try {
        const overview = simplicityService.getOverview();
        res.json(overview);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/simplicity/programs', (req: Request, res: Response) => {
      try {
        const progs = simplicityService.listPrograms();
        res.json(progs);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
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
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/simplicity/programs/:programId/occurrences', (req: Request, res: Response) => {
      try {
        const occurrences = simplicityService.getProgramOccurrences(req.params.programId);
        res.json(occurrences);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/simplicity/transactions/:txid', (req: Request, res: Response) => {
      try {
        const tx = simplicityService.getTransaction(req.params.txid);
        res.json(tx);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/simplicity/toolchains', (req: Request, res: Response) => {
      try {
        const toolchains = simplicityService.listToolchains();
        res.json(toolchains);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/simplicity/programs/decode', (req: Request, res: Response) => {
      try {
        const bytesHex = req.body.program_bytes_hex || req.body.bytes;
        const decoded = simplicityService.decodeProgram(bytesHex);
        res.json(decoded);
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Decoding failed' });
      }
    });

    app.post('/api/v1/intelligence/simplicity/programs/execute', (req: Request, res: Response) => {
      try {
        const result = simplicityService.executeProgram(req.body);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Execution simulation failed' });
      }
    });

    app.post('/api/v1/intelligence/simplicity/formal-artifacts/verify', (req: Request, res: Response) => {
      try {
        const result = simplicityService.verifyFormalArtifact(req.body);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Formal artifact verification error' });
      }
    });
  }
}

export default new SimplicityRoutes();
