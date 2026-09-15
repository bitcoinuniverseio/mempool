import { Application, Request, Response } from 'express';
import { knowledgeRegistryService } from './knowledge-registry.service';
import { ownerOf, requireOwner, sendIdentityError } from '../identity/owner-auth';
import { handleError } from '../../../utils/api';

/** Reads are public; submitting or challenging a label needs an owner key with the knowledge scope. */
class KnowledgeRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/knowledge/';
    const guard = requireOwner('knowledge');

    app
      .get(prefix + 'labels', this.$getLabels)
      .get(prefix + 'labels/:entityId', this.$getLabelByEntity)
      .post(prefix + 'labels', guard, this.$postLabel)
      .post(prefix + 'labels/:id/challenge', guard, this.$postChallenge)
      .get(prefix + 'audit-log', this.$getAuditLog);
  }

  private async $getLabels(req: Request, res: Response): Promise<void> {
    try {
      const category = req.query.category ? String(req.query.category) : undefined;
      const list = await knowledgeRegistryService.getLabels(category);
      res.json({ labels: list, count: list.length });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch labels');
    }
  }

  private async $getLabelByEntity(req: Request, res: Response): Promise<void> {
    try {
      const label = await knowledgeRegistryService.getLabelByEntity(req.params.entityId);
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
      const { entity_type, entity_id, name, category, evidence } = req.body ?? {};
      res.status(201).json(await knowledgeRegistryService.submitLabel(ownerOf(res), entity_type, entity_id, name, category, evidence));
    } catch (e) {
      sendIdentityError(res, e, 'Failed to submit label');
    }
  }

  private async $postChallenge(req: Request, res: Response): Promise<void> {
    try {
      const { dispute_reason, counter_evidence_uri } = req.body ?? {};
      const challenged = await knowledgeRegistryService.challengeLabel(ownerOf(res), req.params.id, dispute_reason, counter_evidence_uri);
      if (!challenged) {
        res.status(404).json({ error: `Label '${req.params.id}' not found or not challengeable.` });
        return;
      }
      res.json({ contested: true, label_id: req.params.id });
    } catch (e) {
      sendIdentityError(res, e, 'Failed to challenge label');
    }
  }

  private async $getAuditLog(req: Request, res: Response): Promise<void> {
    try {
      const log = await knowledgeRegistryService.getAuditLog();
      res.json({ audit_events: log, count: log.length });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch audit log');
    }
  }
}

export default new KnowledgeRoutes();
