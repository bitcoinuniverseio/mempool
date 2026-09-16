import { Application, Request, Response } from 'express';
import config from '../../config';
import { DataStudioService, dataStudioService, DataStudioEvidenceError, MCP_TOOLS } from './data-studio.service';
import { streamData } from './data-studio-stream';
function fail(res: Response, e: unknown) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.status(e instanceof DataStudioEvidenceError ? e.status : 503).json({
    stage: e instanceof DataStudioEvidenceError ? e.code : 'owned-data-unavailable',
    error: e instanceof DataStudioEvidenceError ? e.message : 'Owned Data Studio evidence is unavailable.',
  });
}
export class DataStudioRoutes {
  constructor(private service: DataStudioService = dataStudioService) {}
  initRoutes(app: Application) {
    const prefix = config.MEMPOOL.API_URL_PREFIX + 'data/';
    app.get(prefix + 'catalog', async (_req, res) => {
      try {
        res.json(await this.service.$getCatalog());
      } catch (e) {
        fail(res, e);
      }
    });
    app.post(prefix + 'query', async (req, res) => {
      try {
        res.json(await this.service.$executeQuery(req.body));
      } catch (e) {
        fail(res, e);
      }
    });
    app.get(prefix + 'mcp', async (_req, res) => {
      try {
        const catalog = await this.service.$getCatalog();
        res.json({
          tools: catalog.mcpTools,
          endpoint: prefix + 'mcp/rpc',
          protocolVersion: '2025-03-26',
          scope: 'Executable read-only catalog and typed snapshot query tools.',
        });
      } catch (e) {
        fail(res, e);
      }
    });
    app.get(prefix + 'export/:snapshot/:dataset', async (req, res) => {
      try {
        const format = typeof req.query.format === 'string' ? req.query.format : 'ndjson';
        const out = await this.service.export(req.params.snapshot, req.params.dataset, format);
        res.setHeader(
          'Content-Type',
          format === 'csv' ? 'text/csv; charset=utf-8' : format === 'json' ? 'application/json' : 'application/x-ndjson'
        );
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${req.params.dataset}-${req.params.snapshot}.${format}"`
        );
        res.setHeader('ETag', '"' + out.sha256 + '"');
        res.setHeader('X-Content-SHA256', out.sha256);
        res.setHeader('X-Dataset-Rows', String(out.rowCount));
        res.setHeader('Content-Length', String(out.bytes.length));
        res.send(out.bytes);
      } catch (e) {
        fail(res, e);
      }
    });
    app.get(prefix + 'live/snapshots', async (req, res) => {
      try {
        await streamData(req, res, this.service);
      } catch (e) {
        fail(res, e);
      }
    });
    const originAllowed = (req: Request) => {
      const origin = req.get('Origin');
      if (!origin) return true;
      try {
        const u = new URL(origin);
        const allowed = (process.env.UNIVERSE_DATA_MCP_ORIGINS ?? '').split(',').filter(Boolean);
        return (
          allowed.includes(origin) ||
          (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) &&
            u.host === req.get('host') &&
            ['http:', 'https:'].includes(u.protocol))
        );
      } catch {
        return false;
      }
    };
    app.get(prefix + 'mcp/rpc', (req, res) => {
      if (!originAllowed(req)) return res.status(403).end();
      res.status(405).end();
    });
    app.post(prefix + 'mcp/rpc', async (req, res) => {
      if (!originAllowed(req)) return res.status(403).json({ error: 'Origin rejected' });
      if (!req.accepts('application/json')) return res.status(406).end();
      const batch = Array.isArray(req.body) ? req.body : [req.body];
      if (batch.length === 0 || batch.length > 16) return res.status(400).json({ error: 'Invalid bounded batch' });
      const responses: any[] = [];
      for (const msg of batch) {
        const id = msg?.id;
        if (
          !msg ||
          msg.jsonrpc !== '2.0' ||
          typeof msg.method !== 'string' ||
          (id !== undefined && typeof id !== 'string' && typeof id !== 'number')
        ) {
          responses.push({ jsonrpc: '2.0', id: id ?? null, error: { code: -32600, message: 'Invalid request' } });
          continue;
        }
        if (id === undefined) {
          if (!['notifications/initialized', 'notifications/cancelled'].includes(msg.method))
            return res.status(400).end();
          continue;
        }
        try {
          let result: any;
          if (msg.method === 'initialize')
            result = {
              protocolVersion: '2025-03-26',
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: 'universe-owned-data', version: '1.0.0' },
              instructions:
                'Bounded public owned-node snapshots. Not a complete blockchain dataset. Query a snapshotId for immutable pagination.',
            };
          else if (msg.method === 'ping') result = {};
          else if (msg.method === 'tools/list')
            result = {
              tools: MCP_TOOLS.map((t) => ({
                ...t,
                annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
              })),
            };
          else if (msg.method === 'tools/call') {
            const name = msg.params?.name,
              args = msg.params?.arguments ?? {};
            if (
              name === 'data_catalog' &&
              args &&
              typeof args === 'object' &&
              !Array.isArray(args) &&
              Object.keys(args).length === 0
            )
              result = {
                content: [{ type: 'text', text: JSON.stringify(await this.service.$getCatalog()) }],
                isError: false,
              };
            else if (name === 'data_query')
              result = {
                content: [{ type: 'text', text: JSON.stringify(await this.service.$executeQuery(args)) }],
                isError: false,
              };
            else throw new DataStudioEvidenceError('invalid-tool', 'Unknown tool or invalid tool arguments.', 400);
          } else {
            responses.push({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
            continue;
          }
          responses.push({ jsonrpc: '2.0', id, result });
        } catch (e) {
          responses.push({
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: e instanceof DataStudioEvidenceError ? e.message : 'Owned data source unavailable.',
                },
              ],
              isError: true,
            },
          });
        }
      }
      if (!responses.length) return res.status(202).end();
      res.json(Array.isArray(req.body) ? responses : responses[0]);
    });
  }
}
export default new DataStudioRoutes();
