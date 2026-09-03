import { Application, Request, Response } from 'express';
import { workbenchService } from './workbench.service';
import { handleError } from '../../../utils/api';

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
      handleError(req, res, 500, e instanceof Error ? e.message : 'Script analysis failed');
    }
  }

  private async $postScriptSimulate(req: Request, res: Response): Promise<void> {
    try {
      const hex = String(req.body.script_hex || '');
      const witness = Array.isArray(req.body.witness) ? req.body.witness : [];
      const steps = workbenchService.simulateStack(hex, witness);
      res.json({ steps, count: steps.length });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Simulation failed');
    }
  }

  private async $postMiniscriptCompile(req: Request, res: Response): Promise<void> {
    try {
      const policy = String(req.body.policy || '');
      const compiled = workbenchService.compileMiniscript(policy);
      res.json(compiled);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Miniscript compilation failed');
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
      handleError(req, res, 500, e instanceof Error ? e.message : 'Descriptor parse failed');
    }
  }

  private async $postDescriptorsDerive(req: Request, res: Response): Promise<void> {
    try {
      const desc = String(req.body.descriptor || '');
      const parsed = workbenchService.parseDescriptor(desc);
      res.json({ derived: parsed.derived_samples, count: parsed.derived_samples.length });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Derivation failed');
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
      handleError(req, res, 500, e instanceof Error ? e.message : 'PSBT analysis failed');
    }
  }
}

export default new WorkbenchRoutes();
