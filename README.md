# GateCheck

Shared scaffold for the GateCheck testnet app. This repository currently includes the React client, Express server, and shared TypeScript contracts. Ledger transactions and policy/API features are not part of this scaffold.

## Prerequisites

- Node.js 20 or newer, which includes npm

## Install

```bash
npm install
```

## Development

```bash
npm run dev
```

Open http://localhost:5173

- Frontend: Vite on port 5173
- API: Express on port 3001
- The page requests `/api/health`. Vite proxies `/api` to http://127.0.0.1:3001

`GET /api/health` returns `{ "ok": true, "mode": "testnet" }`.

## Typecheck, build, and production

```bash
npm run typecheck
npm run build
npm start
```

`npm run typecheck` checks shared types, the frontend, and the backend.

`npm run build` writes the server to `dist/server` and the client to `dist/client`.

`npm start` runs the built server and serves the built frontend at http://localhost:3001

## Module settings

The package is an ECMAScript module. The server compiles with `NodeNext` so Node can run the build. The client uses bundler module resolution for Vite. Both projects typecheck `src/shared/contracts.ts`.
