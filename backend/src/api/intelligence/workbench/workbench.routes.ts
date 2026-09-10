import { Application, Request, Response } from 'express';
import { WorkbenchEvidenceError, workbenchService } from './workbench.service';
import { handleError } from '../../../utils/api';

/** An absent engine is a 503 that names the engine, never a 500 and never an invented analysis. */
function fail(req: Request, res: Response, e: unknown, fallback: string): void {
  if (e instanceof WorkbenchEvidenceError) {
    res.status(e.status).json({ stage: e.code, error: e.message });
    return;
  }
  handleError(req, res, 500, e instanceof Error ? e.message : fallback);
}

class WorkbenchRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/workbench/';

    app
      .post(prefix + 'script/analyze', this.$postScriptAnalyze)
      .post(prefix + 'script/simulate', this.$postScriptSimulate)
      .post(prefix + 'miniscript/compile', this.$postMiniscriptCompile)
      .post(prefix + 'descriptors/parse', this.$postDescriptorsParse)
      .post(prefix + 'descriptors/derive', this.$postDescriptorsDerive)
      .post(prefix + 'psbt/analyze', this.$postPsbtAnalyze);
  }

  private async $postScriptAnalyze(req: Request, res: Response): Promise<void> {
    try {
      const hex = String(req.body.script_hex || '');
      if (!hex) {
        res.status(400).json({ error: 'script_hex parameter required.' });
        return;
      }
      const result = workbenchService.analyzeScript(hex);
      res.json(result);
    } catch (e) {
      fail(req, res, e, 'Script analysis failed');
    }
  }

  private async $postScriptSimulate(req: Request, res: Response): Promise<void> {
    try {
      const hex = String(req.body.script_hex || '');
      const witness = Array.isArray(req.body.witness) ? req.body.witness : [];
      const steps = workbenchService.simulateStack(hex, witness);
      res.json({ steps, count: steps.length });
    } catch (e) {
      fail(req, res, e, 'Simulation failed');
    }
  }

  private async $postMiniscriptCompile(req: Request, res: Response): Promise<void> {
    try {
      const policy = String(req.body.policy || '');
      const compiled = workbenchService.compileMiniscript(policy);
      res.json(compiled);
    } catch (e) {
      fail(req, res, e, 'Miniscript compilation failed');
    }
  }

  private async $postDescriptorsParse(req: Request, res: Response): Promise<void> {
    try {
      const desc = String(req.body.descriptor || '');
      if (!desc) {
        res.status(400).json({ error: 'descriptor parameter required.' });
        return;
      }
      const parsed = workbenchService.parseDescriptor(desc);
      res.json(parsed);
    } catch (e) {
      fail(req, res, e, 'Descriptor parse failed');
    }
  }

  private async $postDescriptorsDerive(req: Request, res: Response): Promise<void> {
    try {
      const desc = String(req.body.descriptor || '');
      const parsed = workbenchService.parseDescriptor(desc);
      res.json({ derived: parsed.derived_samples, count: parsed.derived_samples.length });
    } catch (e) {
      fail(req, res, e, 'Derivation failed');
    }
  }

  private async $postPsbtAnalyze(req: Request, res: Response): Promise<void> {
    try {
      const psbt = String(req.body.psbt || '');
      if (!psbt) {
        res.status(400).json({ error: 'psbt parameter required.' });
        return;
      }
      const analyzed = workbenchService.analyzePsbt(psbt);
      res.json(analyzed);
    } catch (e) {
      fail(req, res, e, 'PSBT analysis failed');
    }
  }
}

export default new WorkbenchRoutes();
