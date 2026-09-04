import { Application, Request, Response } from 'express';
import { templateCollectorService } from './template-collector.service';
import { handleError } from '../../../utils/api';
import { eventBus } from '../events/intelligence-event-bus';

class TemplatesRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/templates/';

    app
      .get(prefix + 'overview', this.$getOverview)
      .get(prefix + 'sources', this.$getSources)
      .get(prefix + 'policy-fingerprints', this.$getFingerprints)
      .get(prefix + 'blocks/:blockHash/comparison', this.$getBlockComparison)
      .get(prefix + ':templateId/diff/:otherTemplateId', this.$getDiff)
      .get(prefix + ':templateId', this.$getTemplate)
      .get(prefix + 'stream', this.$getStream);
  }

  private async $getOverview(req: Request, res: Response): Promise<void> {
    try {
      const sources = templateCollectorService.getSources();
      const templates = templateCollectorService.getTemplatesForHeight();
      res.json({
        sources_count: sources.length,
        candidate_templates_count: templates.length,
        sources,
        latest_templates: templates,
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
      const diff = templateCollectorService.computeTemplateDiff(
        req.params.templateId,
        req.params.otherTemplateId
      );
      res.json(diff);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to diff templates');
    }
  }

  private async $getBlockComparison(req: Request, res: Response): Promise<void> {
    try {
      const comparison = templateCollectorService.compareMinedBlock(req.params.blockHash);
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
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const unsubscribe = eventBus.subscribe('btc.*.template.*', (envelope) => {
      res.write(`event: intelligence.template.observed\ndata: ${JSON.stringify(envelope)}\n\n`);
    });

    const keepAliveTimer = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAliveTimer);
      unsubscribe();
    });
  }
}

export default new TemplatesRoutes();
