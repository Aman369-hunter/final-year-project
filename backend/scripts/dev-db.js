// Local MongoDB for development, for machines without MongoDB or Docker installed.
// Runs a real mongod (downloaded once by mongodb-memory-server) on 127.0.0.1:27017,
// with data kept in backend/.data/db between runs. Ctrl+C to stop.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const dbPath = fileURLToPath(new URL('../.data/db', import.meta.url));
mkdirSync(dbPath, { recursive: true });

const port = Number(process.env.MONGO_PORT) || 27017;
const server = await MongoMemoryServer.create({
  instance: { port, ip: '127.0.0.1', dbPath, storageEngine: 'wiredTiger' },
});
console.log(`MongoDB ready at ${server.getUri()} (data: backend/.data/db)`);

const stop = async () => {
  await server.stop({ doCleanup: false });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
