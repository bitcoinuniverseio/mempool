import { Application, Request, Response } from 'express';
import { templateCollectorService } from './template-collector.service';
import { handleError } from '../../../utils/api';
import config from '../../../config';
import { eventBus } from '../events/intelligence-event-bus';

const OVERVIEW_TEMPLATES = 24;

class TemplatesRoutes {
  public initRoutes(app: Application): void {
    /* IMPLEMENTATION-HANDOFF [WP-BI-005] DEF-BI-005; COV-BI-005E.
     * The literal stream precedes the template-ID route and consumes the selected
     * network's published envelopes. Replay gaps and provider failure are explicit;
     * mounted native producer/consumer acceptance is separate from source wiring.
     * 1. Register literal stream before :templateId and validate template IDs. Keep
     *    overview/sources/fingerprints/diff/comparison routes reachable unchanged.
     * 2. After the provider and collector changes, subscribe to the selected network's
     *    template subject and emit SSE id/event/data. Support bounded Last-Event-ID
     *    replay and truthful gap/reset state; bound slow-client buffers and close/
     *    unsubscribe on disconnect, write failure, shutdown and provider failure.
     * 3. Add a real Express route test in templates.test.ts: /stream responds with
     *    text/event-stream, a collected template appears, reconnect resumes, unknown
     *    template remains 404 and all named routes still use their intended handler.
     * Dependencies: WP-BI-005 event provider/wildcards and collector publication;
     *    source: actual registered routes, NATS subject semantics and SSE consumer contract.
     * Command: cd backend && ./node_modules/.bin/jest --runInBand --coverage=false
     *    --runTestsByPath src/api/intelligence/templates/templates.test.ts
     * Network stream acceptance is NOT TESTED. Rollback preserves event cursors and
     *    distinguishes a replay gap from an empty stream; do not fake keepalive success.
     */
    const prefix = '/api/v1/intelligence/templates/';

    app
      .get(prefix + 'overview', this.$getOverview)
      .get(prefix + 'sources', this.$getSources)
      .get(prefix + 'policy-fingerprints', this.$getFingerprints)
      .get(prefix + 'blocks/:blockHash/comparison', this.$getBlockComparison)
      .get(prefix + ':templateId/diff/:otherTemplateId', this.$getDiff)
      .get(prefix + 'stream', this.$getStream)
      .get(prefix + ':templateId', this.$getTemplate);
  }

  private async $getOverview(req: Request, res: Response): Promise<void> {
    try {
      const sources = templateCollectorService.getSources();
      const templates = templateCollectorService.getTemplatesForHeight();
      // The overview shows the newest collections; the full list is paged through the stream and per-height routes.
      res.json({
        configured_network: config.MEMPOOL.NETWORK,
        current_observation_context: templateCollectorService.getCurrentObservationContext(),
        sources_count: sources.length,
        candidate_templates_count: templates.length,
        sources,
        latest_templates: templates.slice(-OVERVIEW_TEMPLATES).reverse(),
      });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch templates overview');
    }
  }

  private async $getSources(req: Request, res: Response): Promise<void> {
    try {
      const sources = templateCollectorService.getSources();
      res.json({ sources, total: sources.length });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch template sources');
    }
  }

  private async $getTemplate(req: Request, res: Response): Promise<void> {
    try {
      const template = templateCollectorService.getTemplateById(req.params.templateId);
      if (!template) {
        res.status(404).json({ error: `Template '${req.params.templateId}' not found.` });
        return;
      }
      res.json(template);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch template');
    }
  }

  private async $getDiff(req: Request, res: Response): Promise<void> {
    try {
      const diff = templateCollectorService.computeTemplateDiff(req.params.templateId, req.params.otherTemplateId);
      if (!diff) {
        res.status(404).json({ error: 'Both templates must be ones this backend collected.' });
        return;
      }
      res.json(diff);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to diff templates');
    }
  }

  private async $getBlockComparison(req: Request, res: Response): Promise<void> {
    try {
      const comparison = templateCollectorService.compareMinedBlock(req.params.blockHash);
      if (!comparison) {
        res.status(404).json({ error: 'No template was collected for this block before it was mined, or the block was not observed by this backend.', code: 'no-comparison' });
        return;
      }
      res.json(comparison);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to compare block with template');
    }
  }

  private async $getFingerprints(req: Request, res: Response): Promise<void> {
    try {
      const fps = templateCollectorService.getPolicyFingerprints();
      res.json({ fingerprints: fps, total: fps.length });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch fingerprints');
    }
  }

  private async $getStream(req: Request, res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const subject = `btc.${config.MEMPOOL.NETWORK}.template.*`;
    let keepAliveTimer: NodeJS.Timeout;
    let closed = false;
    let unsubscribe: () => void = () => undefined;
    const cleanup = () => { if (!closed) { closed = true; clearInterval(keepAliveTimer); unsubscribe(); } };
    const write = (data: string) => {
      if (closed) return;
      if (res.writableLength > 262144) { cleanup(); res.end(); return; }
      try { if (!res.write(data)) { cleanup(); res.end(); } } catch { cleanup(); res.destroy(); }
    };
    req.on('close', cleanup);
    res.on('error', cleanup);
    const cursor = req.headers['last-event-id'];
    let replaying = true;
    const pending: Array<Parameters<typeof eventBus.publish>[1]> = [];
    const seen = new Set<string>();
    const emit = (envelope: Parameters<typeof eventBus.publish>[1]) => {
      if(seen.has(envelope.event_id))return;
      seen.add(envelope.event_id);
      if(seen.size>1000)seen.delete(seen.values().next().value!);
      write(`id: ${envelope.event_id}\nevent: intelligence.template.observed\ndata: ${JSON.stringify(envelope)}\n\n`);
    };
    try {
      unsubscribe = await eventBus.subscribe(subject, (envelope, ack) => {
        if(replaying) {if(pending.length>=1000){cleanup();res.end();return;}pending.push(envelope);} else emit(envelope);
        ack();
      });
      if(closed){unsubscribe();return;}
      const recent = typeof cursor==='string' ? await eventBus.replayStored(subject) : [];
      if (typeof cursor === 'string') {
        const index = recent.findIndex(envelope => envelope.event_id === cursor);
        if (index < 0) write('event: reset\ndata: {"reason":"replay_gap"}\n\n');
        else for (const envelope of recent.slice(index + 1)) emit(envelope);
      }
      replaying=false;
      for(const envelope of pending)emit(envelope);
    } catch {write('event: unavailable\ndata: {"reason":"provider_unavailable"}\n\n');cleanup();res.end();return;}
    keepAliveTimer = setInterval(() => write(': keepalive\n\n'), 15000);
    req.on('close', cleanup);
    res.on('error', cleanup);

  }
}

export default new TemplatesRoutes();
