// Section 3.3 POST /api/punnett, proxied to the engine's /punnett.
// Contains no patient data, so any signed-in role may call it.
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { runPunnett } from '../services/scoring.js';
import { punnettBody } from './schemas.js';

export function punnettRouter() {
  const r = Router();
  r.post('/', authenticate, validate({ body: punnettBody }), async (req, res) => {
    res.json(await runPunnett(req.valid.body));
  });
  return r;
}
