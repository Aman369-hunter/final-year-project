import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { predictionFilter } from './middleware/predictionFilter.js';
import { authRouter } from './routes/auth.js';
import { casesRouter } from './routes/cases.js';
import { patientsRouter } from './routes/patients.js';
import { predictRouter } from './routes/predict.js';
import { punnettRouter } from './routes/punnett.js';
import { referenceRouter } from './routes/reference.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback'); // Vite dev proxy; set properly behind a real proxy in deployment

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  // Installed before every router, so no route can bypass it.
  app.use(predictionFilter);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter());
  app.use('/api/cases', casesRouter());
  app.use('/api/patients', patientsRouter());
  app.use('/api/predict', predictRouter());
  app.use('/api/punnett', punnettRouter());
  app.use('/api/reference', referenceRouter());

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
