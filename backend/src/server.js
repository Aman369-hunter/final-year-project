import mongoose from 'mongoose';
import { createApp } from './app.js';
import { config } from './config.js';
import { assertEncryptionKey } from './services/fieldCrypto.js';

// Fail fast on missing secrets rather than on the first request.
void config.jwtAccessSecret;
assertEncryptionKey();

try {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
} catch {
  console.error(`Could not reach MongoDB at ${config.mongoUri}. Start it with \`npm run db\` in another terminal.`);
  process.exit(1);
}

createApp().listen(config.port, () => console.log(`backend listening on http://localhost:${config.port}`));
