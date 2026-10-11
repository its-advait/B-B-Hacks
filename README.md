# GateCheck

GateCheck is an XRPL dashboard for comparing an intended credential rule with the outcome of direct incoming payments on a supported test network. It uses fake funds. It is a hackathon demonstration, not a production compliance guarantee and not a full mainnet clone.

The dashboard shows the treasury, issuer, credential type, Deposit Authorization, the trusted credential rule, and three actors: a valid customer, a legacy customer with a direct wallet approval, and a stranger. Checks submit one fixed payment from each actor. A mismatch can produce one stored `DepositPreauth` `Unauthorize` plan. That plan is submitted only after an operator checks the box and clicks Approve repair. Success is a validated `tesSUCCESS` receipt on a session that has returned to ready. After checks are a separate click, and only after that receipt.

Supported scope is direct incoming Payments to the treasury under Deposit Authorization. Other transaction types, arbitrary destinations, and mainnet signing are outside this build.

## Team

- Teammate A owns the ledger module in `src/server/ledger`.
- Teammate B owns policy evaluation and the session API in `src/server/policy` and `src/server/api`.
- Aren owns the dashboard in `src/client` and this integration.

Shared response shapes live in `src/shared/contracts.ts`. The server keeps ledger sessions in memory and returns a public projection.

## Prerequisites

- Node.js 22 or newer, which includes npm

## Commands

```bash
npm ci
npm run dev
npm run typecheck
npm run build
npm start
npx tsx --test src/server/policy/policy.test.ts src/server/api/aLedger.test.ts src/server/api/api.test.ts
```

`npm run dev` starts the API on port 3001 and Vite on http://127.0.0.1:5173. Vite proxies `/api` to http://127.0.0.1:3001.

`npm run build` writes the server to `dist/server` and the client to `dist/client`. `npm start` serves both from the built server. `PORT` selects the listen port and defaults to 3001.

`GET /api/health` returns `{ "ok": true, "mode": "testnet" }`. That `mode` means this product is not a mainnet signer. The ledger network name comes from the session snapshot and is `devnet` or `testnet`.

There is no `npm test` script. The command above is the API and policy suite. It uses in-memory fixtures. An empty ledger module fails closed, and those tests do not create accounts or open the XRPL WebSocket.

## Devnet

The default endpoint is `wss://s.devnet.rippletest.net:51233`. The only other accepted endpoint is the official Testnet socket `wss://s.altnet.rippletest.net`. The client rejects other WebSocket URLs, including mainnet. `GATECHECK_NETWORK` must match the endpoint when it is set.

Disposable account material stays in `GATECHECK_PRIVATE_DIR` (default `.private`). Repair journals and stored plans stay in `GATECHECK_RUNTIME_DIR` (default `.runtime`). Both directories are gitignored. Do not commit them or print seeds.

Official references:

- [XRPL documentation](https://xrpl.org/docs)
- [Deposit Authorization](https://xrpl.org/docs/concepts/accounts/depositauth)
- [DepositPreauth](https://xrpl.org/docs/references/protocol/transactions/types/depositpreauth)
- [XRP test-network faucets](https://xrpl.org/resources/dev-tools/xrp-faucets)

## Fixtures

In `npm run dev`, a Development fixture switch is available and starts off. Turning it on shows labeled sample accounts and sample hashes. Fixture actions do not call the session API and do not submit payments. The production build from `npm start` does not show the switch.

## Session loss

Sessions, wallets, and job state live in the API process. Restarting the server drops the live session. The page keeps the last displayed evidence and does not create a replacement or resubmit a repair on its own. An optional public JSON copy can be written for inspection, and that copy is not loaded back into a live session.

A repair plan is checked against a fresh snapshot before submission. A stale plan returns `409` with `stale_plan` and is not submitted. A `202` response means the job was accepted. The dashboard treats a repair as successful only when the later session has a validated `tesSUCCESS` receipt and status `ready`.

## Verified evidence

The dashboard flow below was exercised with fake Devnet funds. Hashes are public transaction identifiers.

Previous recording, on the frontend commit `a9edce1`, before this API update. Session `befb6623-b093-48e0-8b50-76eb5cd5b331` on Devnet:

- Before report `21cfbc7a-a778-44ec-877e-c3264391dc33`: valid customer matched (`tesSUCCESS`, `6708C8399EB1642A38708A7D6D64947C640446FA1F4DC4AC90A42560CF9A45EA`); legacy customer mismatched (`tesSUCCESS`, `BE66A2681BD9CD3195EA3C0B7E5860461A88360D9D2A5639B185C604F91087CE`); stranger matched (`tecNO_PERMISSION`, `C3904F0CE2A78B248B380B29E633A9F59D638EC2946C153A2A9BD5A70032A38A`).
- Approved repair plan `562f3403-cabd-4349-a81d-153ea49de33a` validated `tesSUCCESS`, hash `EFB98AAEA2AAD8193CD9C1D2CBB9BB7F9A314C40FA6E4BD9266BC82044ADD08B`.
- After report `b63bd560-7cc2-4d62-8f0b-ea0202962eba`: all three actors matched. Legacy and stranger were `tecNO_PERMISSION`.

That recording used the API integrated before commits `9bb5d8e` and `e791428`. Its repair description said "Testnet configuration change" even though the snapshot network was Devnet.

Updated API, isolated from that recording, on this release branch. One new Devnet environment and one before suite, session `736157e0-d11b-4fcc-a2b9-0fc91b82e236`:

- Setup reached ready on Devnet. The page label was "Devnet / fake funds".
- Before report `b139709a-8c46-4ba9-9fcb-b9563de8db12`: valid customer matched (`tesSUCCESS`, `AF86958DD0515EEA69CCEC7CD0F646A112726A22117040D77AFBF249D13FF537`); legacy customer mismatched (`tesSUCCESS`, `CA0F4F11E231315365AB640BB3F9CDBB90B96882A8A4A9FCBA2395A1046F0DB1`); stranger matched (`tecNO_PERMISSION`, `5323667B86F39FCC78F7B1B9385E2AA34ABFB594F388236FC8358306662AA320`).
- The stored plan says "Devnet configuration change" and has not been submitted. After checks on this API version have not been run.

Automated checks on this branch: `npm ci`, the API and policy suite (30 tests), `npm run typecheck`, and `npm run build`.

## Submission placeholders

- YouTube: `YOUTUBE_URL`
- Optional evidence site: `EVIDENCE_SITE_URL`
