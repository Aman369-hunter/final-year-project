// Section 3.3 /api/reference/*. Static reference data for the forms. Any
// signed-in role may read it; it holds no patient data.
import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';

const VARIANTS_DIR = new URL('../../../data/variants/autocomplete/', import.meta.url);
const SYMPTOM_CATALOG = new URL('../../../data/symptom-catalog.json', import.meta.url);
const GENE = z.object({ gene: z.string().regex(/^[A-Z0-9]{2,8}$/i) });

let indexCache;
let symptomCache;
const geneCache = new Map();

async function loadJson(url) {
  return JSON.parse(await readFile(fileURLToPath(url), 'utf8'));
}

export function referenceRouter() {
  const r = Router();
  r.use(authenticate);

  // Section 6.1: the plain-language symptom questionnaire, grouped by body system.
  // Each item carries the HPO id it maps to behind the scenes; the patient never sees it.
  r.get('/symptoms', async (_req, res) => {
    symptomCache ??= await loadJson(SYMPTOM_CATALOG);
    res.json(symptomCache);
  });

  // The ClinVar genes available for variant autocomplete.
  r.get('/variants', async (_req, res) => {
    indexCache ??= await loadJson(new URL('index.json', VARIANTS_DIR));
    res.json(indexCache);
  });

  // The known pathogenic/likely-pathogenic variants for one gene.
  r.get('/variants/:gene', validate({ params: GENE }), async (req, res) => {
    const gene = req.valid.params.gene.toUpperCase();
    if (!geneCache.has(gene)) {
      try {
        geneCache.set(gene, await loadJson(new URL(`${gene}.json`, VARIANTS_DIR)));
      } catch {
        throw new HttpError(404, 'unknown_gene', 'No variant table for that gene.');
      }
    }
    res.json(geneCache.get(gene));
  });

  return r;
}
