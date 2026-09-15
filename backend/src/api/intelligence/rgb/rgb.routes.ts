import { Application } from 'express';
import { RgbAnchorReader, RgbEvidenceError } from './rgb-anchor-reader';
export default { initRoutes(app: Application): void {
  app.post('/api/v1/intelligence/rgb/anchors', async (req, res) => {
    if (!req.body || Object.keys(req.body).some(key => key !== 'txids')) { res.status(400).json({ error: 'Only public txids are accepted. Keep consignments local.' }); return; }
    try { res.json(await new RgbAnchorReader().read(req.body.txids)); }
    catch (e) { res.status(e instanceof RgbEvidenceError ? e.status : 503).json({ error: e instanceof RgbEvidenceError ? e.message : 'Public RGB anchor source unavailable.' }); }
  });
} };
