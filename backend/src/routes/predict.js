// Section 3.1 POST /api/predict, proxied to the engine's /predict.
// Requires a token; predictionFilter strips the prediction blocks for every
// role except doctor, exactly as with the Phase 1 stub.
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { audit } from '../services/audit.js';
import { runPrediction } from '../services/scoring.js';
import { predictBody } from './schemas.js';

export function predictRouter() {
  const r = Router();
  r.post('/', authenticate, validate({ body: predictBody }), async (req, res) => {
    const response = await runPrediction(req.valid.body);
    await audit(req.user, 'predict.run', { resourceType: 'predict' });
    res.json(response);
  });
  return r;
}
