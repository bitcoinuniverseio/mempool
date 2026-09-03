import { Application, Request, Response } from 'express';
import { knowledgeRegistryService } from './knowledge-registry.service';
import { handleError } from '../../../utils/api';

class KnowledgeRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/knowledge/';

    app
      .get(prefix + 'labels', this.$getLabels)
      .get(prefix + 'labels/:entityId', this.$getLabelByEntity)
      .post(prefix + 'labels', this.$postLabel)
      .post(prefix + 'labels/:id/challenge', this.$postChallenge)
      .get(prefix + 'audit-log', this.$getAuditLog);
  }

  private async $getLabels(req: Request, res: Response): Promise<void> {
    try {
      const category = req.query.category ? String(req.query.category) : undefined;
      const list = knowledgeRegistryService.getLabels(category);
      res.json({ labels: list, count: list.length });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch labels');
    }
  }

  private async $getLabelByEntity(req: Request, res: Response): Promise<void> {
    try {
      const label = knowledgeRegistryService.getLabelByEntity(req.params.entityId);
      if (!label) {
        res.status(404).json({ error: `Label for entity '${req.params.entityId}' not found.` });
        return;
      }
      res.json(label);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch label');
    }
  }

  private async $postLabel(req: Request, res: Response): Promise<void> {
    try {
      const { actor_id, entity_type, entity_id, name, category, evidence } = req.body;
      if (!entity_id || !name || !category) {
        res.status(400).json({ error: 'entity_id, name, and category required.' });
        return;
      }
      const label = knowledgeRegistryService.submitLabel(
        actor_id || 'community-contributor',
        entity_type || 'address',
        entity_id,
        name,
        category,
        evidence || []
      );
      res.json(label);
    } catch (e) {
      handleError(req, res, 400, e instanceof Error ? e.message : 'Failed to submit label');
    }
  }

  private async $postChallenge(req: Request, res: Response): Promise<void> {
    try {
      const { actor_id, dispute_reason, counter_evidence_uri } = req.body;
      if (!dispute_reason) {
        res.status(400).json({ error: 'dispute_reason required.' });
        return;
      }
      const challenged = knowledgeRegistryService.challengeLabel(
        req.params.id,
        actor_id || 'community-challenger',
        dispute_reason,
        counter_evidence_uri || ''
      );
      if (!challenged) {
        res.status(404).json({ error: `Label '${req.params.id}' not found.` });
        return;
      }
      res.json({ contested: true, label_id: req.params.id });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to challenge label');
    }
  }

  private async $getAuditLog(req: Request, res: Response): Promise<void> {
    try {
      const log = knowledgeRegistryService.getAuditLog();
      res.json({ audit_log: log, count: log.length });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch audit log');
    }
  }
}

export default new KnowledgeRoutes();
