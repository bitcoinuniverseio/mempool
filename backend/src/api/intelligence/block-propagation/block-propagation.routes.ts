import { Application, Request, Response } from 'express';
import blockPropagationService from './block-propagation.service';

class BlockPropagationRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/block-propagation/overview', (_req: Request, res: Response) => {
      try {
        const overview = blockPropagationService.getOverview();
        res.json(overview);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/block-propagation/live', (_req: Request, res: Response) => {
      try {
        const live = blockPropagationService.getLive();
        res.json(live);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/block-propagation/blocks/:blockHash', (req: Request, res: Response) => {
      try {
        const block = blockPropagationService.getBlock(req.params.blockHash);
        if (!block) {
          return res.status(404).json({ error: 'Block propagation record not found' });
        }
        res.json(block);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/block-propagation/compact-blocks', (_req: Request, res: Response) => {
      try {
        const compactBlocks = blockPropagationService.listCompactBlocks();
        res.json(compactBlocks);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/block-propagation/fork-races', (_req: Request, res: Response) => {
      try {
        const forkRaces = blockPropagationService.listForkRaces();
        res.json(forkRaces);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/block-propagation/fork-races/:raceId', (req: Request, res: Response) => {
      try {
        const race = blockPropagationService.getForkRace(req.params.raceId);
        if (!race) {
          return res.status(404).json({ error: 'Fork race record not found' });
        }
        res.json(race);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/block-propagation/stale-tips', (_req: Request, res: Response) => {
      try {
        const staleTips = blockPropagationService.listStaleTips();
        res.json(staleTips);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/block-propagation/sensors', (_req: Request, res: Response) => {
      try {
        const sensors = blockPropagationService.listSensors();
        res.json(sensors);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/block-propagation/fibre', (_req: Request, res: Response) => {
      try {
        const fibre = blockPropagationService.listFibre();
        res.json(fibre);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/block-propagation/stream', (_req: Request, res: Response) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify({ event: 'connected', timestamp: Date.now() })}\n\n`);
      const timer = setInterval(() => {
        res.write(`data: ${JSON.stringify({ event: 'ping', timestamp: Date.now() })}\n\n`);
      }, 15000);
      _req.on('close', () => {
        clearInterval(timer);
      });
    });
  }
}

export default new BlockPropagationRoutes();
