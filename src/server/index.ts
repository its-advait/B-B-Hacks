import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT ?? 3001);
const app = express();

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mode: 'testnet' });
});

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const runningFromBuild = path.basename(path.dirname(serverDir)) === 'dist';

if (runningFromBuild) {
  const clientDir = path.resolve(serverDir, '../client');
  app.use(express.static(clientDir));
}

app.listen(port, '0.0.0.0', () => {
  console.log(`GateCheck API listening on http://127.0.0.1:${port}`);
});
