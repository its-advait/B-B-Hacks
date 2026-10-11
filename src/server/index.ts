import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './api/createApp.js';
import { disconnectLoadedLedger, loadLedgerPort } from './api/ledgerAdapter.js';

const port = Number(process.env.PORT ?? 3001);
const app = createApp({
  resolveLedger: loadLedgerPort,
  publicMetadataDir: process.env.GATECHECK_SESSION_DIR,
});

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const runningFromBuild = path.basename(path.dirname(serverDir)) === 'dist';

if (runningFromBuild) {
  const clientDir = path.resolve(serverDir, '../client');
  app.use(express.static(clientDir));
}

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`GateCheck API listening on http://127.0.0.1:${port}`);
});

let closing = false;

function shutdown(): void {
  if (closing) {
    return;
  }
  closing = true;
  server.close(() => {
    void disconnectLoadedLedger().finally(() => {
      process.exit(0);
    });
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
