# Teammate B handoff

Repository: `https://github.com/its-advait/B-B-Hacks`  
API branch: `api`  
B owns `src/server/api/**`, `src/server/policy/**`, and `src/server/index.ts`.

A owns `src/server/ledger/**`. The integration lead owns `src/client/**`, `src/shared/contracts.ts`, `package.json`, lockfiles, root config, and `README.md`. This note does not change those files.

## What the API does

The server is a controlled Devnet/Testnet demo. It does not accept wallet seeds, client-built transactions, or a mainnet signing path. Health reports the product mode, not a claim that a fixture server is a live ledger:

`GET /api/health` → `{ "ok": true, "mode": "testnet" }`

Live work loads `src/server/ledger/index.ts` at runtime. When the frozen exports exist, B calls `createDemoEnvironment`, `readSnapshot`, `sendTestPayment`, and `removeIndividualApproval`. If that module is missing, jobs fail closed. There is no fixture fallback in `src/server/index.ts`.

A's client already rejects every endpoint except the official Devnet and Testnet WebSocket URLs. B additionally refuses to mark a session ready when the snapshot network is not `devnet` or `testnet`.

## Credential meaning used by the evaluator

`Actor.credentialStatus === 'valid'` means A's adapter found an accepted, unexpired credential that belongs to that actor and was issued for the snapshot issuer and credential type. The evaluator does not re-read the ledger. It allows that actor only when the snapshot issuer and credential type still match intended policy, or when the address is an exact intended exception.

`revoked` is used only when this session recorded a validated credential delete. A missing credential is `none`. Direct ledger approvals, DepositAuth, and trusted-credential-rule presence do not change the expected result. Address comparison is case-sensitive. Even-length hex credential types compare in canonical hex case; human-readable names keep their case.

Only a validated `tecNO_PERMISSION` with a transaction hash is an observed block. `tesSUCCESS` with a hash is an observed allow. Every other code, including `tecUNFUNDED_PAYMENT`, timeouts, and missing hashes, stays inconclusive.

## Public and private state

Public JSON is `PublicSession`: status, progress, snapshot, immutable reports, a validated repair receipt, and a sanitized error. `GET` returns a structured clone. Reports keep before and after history, timestamps, ledger codes, hashes, and the reviewed unsigned `DepositPreauth` / `Unauthorize` transaction.

Private memory holds the opaque ledger session, intended policy, the mutation lock, the active plan, and consumed or uncertain plan ids. It is not logged and not spread into responses. Wallet seeds stay inside A's process memory.

If `GATECHECK_SESSION_DIR` is set, B writes only that public projection, using a temp file and rename. A restart does not load those files. An unknown id is `404` and must be recreated. Please gitignore `GATECHECK_SESSION_DIR`, plus A's `.private` and `.runtime` directories.

## Endpoints

Errors are `{ "error": { "code": "string", "message": "string" } }`. Only literal boolean `true` counts as approval. Request bodies are limited to 16kb. Ids are bounded. Unknown `/api/*` routes return JSON 404. `202` means the job was accepted. Completion, failure, and inconclusive results appear on `GET`.

### `POST /api/sessions`

```json
{ "approveTestnetSetup": true }
```

`202`

```json
{ "sessionId": "7c9e6679-7425-40de-944b-e07fc1f90ae7" }
```

Missing approval is `400 approval_required`.

### `GET /api/sessions/:id`

`200` `PublicSession`

```json
{
  "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "status": "ready",
  "network": "devnet",
  "progress": "Checks complete. A repair plan is waiting for review.",
  "snapshot": {
    "network": "devnet",
    "ledgerIndex": 100,
    "treasuryAddress": "rTreasury",
    "issuerAddress": "rIssuer",
    "credentialType": "customer",
    "depositAuthEnabled": true,
    "trustedCredentialRulePresent": true,
    "actors": [],
    "capturedAt": "2026-01-01T00:00:00.000Z"
  },
  "reports": [],
  "repairReceipt": {
    "transactionHash": "A8DC…",
    "resultCode": "tesSUCCESS",
    "validated": true
  }
}
```

`repairReceipt` is omitted until a validated repair exists. `error` is omitted unless the session failed or verification is uncertain. The frontend can download this JSON directly. There is no separate export route.

### `POST /api/sessions/:id/checks`

```json
{ "phase": "before", "approveTestPayments": true }
```

`phase` is `before` or `after`. `202 { "sessionId": "..." }`.

Before checks are allowed once setup is ready. After checks require a validated `tesSUCCESS` repair receipt. A second check while one is running is `409 job_in_progress`.

### `POST /api/sessions/:id/repair`

```json
{ "planId": "stored-plan-id", "approved": true }
```

Any other field, including a client `unsignedTransaction`, is `400 invalid_body` and makes no ledger call. The handler holds the session lock, reads fresh state, and returns `409 stale_plan` before `202` when the fingerprint, treasury, approval, or exception no longer matches. A matching plan returns `202`, then submits in the background.

Repair submission calls `removeIndividualApproval(session, storedAddress)` only. The browser cannot choose the address.

## State transitions

| Status | Meaning | Buttons |
|---|---|---|
| `settingUp` | Environment job is running | Disable setup, checks, and repair. Show `progress`. |
| `ready` | Idle. Snapshot is present. | Enable before checks. Enable repair only when the latest before report has a `repairPlan`. Enable after checks only when `repairReceipt.validated` is true. |
| `checking` | Payments are running | Disable every action. |
| `repairing` | Reviewed removal was accepted and is still running | Disable every action. |
| `error` | Setup, checks, or repair failed | Show `error`. Offer a new session when setup failed or the repair text says a fresh environment is required. Do not offer the same repair again. |

Poll `GET /api/sessions/:id` immediately after every `202`, once per second. Stop when status is `ready` or `error`. Treat a report as new only when its `id` was not in the previous response. Phase alone is not enough, because the before report stays in the array.

A `409 stale_plan` means the stored plan was invalidated and nothing was submitted. Show the error message and offer Run checks again.

An inconclusive row is a neutral or warning state. Do not show it as a successful block. Expected blocked plus observed blocked, with verdict `match`, is a passing assertion. A network failure is never successful protection.

The repair receipt and the after report are different objects. The receipt says the removal transaction validated. The after report is a new payment suite.

## Repair limits

The only generated transaction is:

```json
{
  "TransactionType": "DepositPreauth",
  "Account": "<snapshot treasury>",
  "Unauthorize": "<one actor address>"
}
```

It is proposed only when a validated allowed payment was expected blocked, that actor has a direct approval, the address is not an intended exception, and DepositAuth is enabled. One report holds one plan. The fingerprint covers the shared snapshot fields listed in `src/server/policy/fingerprint.ts` (network, treasury, issuer, type, DepositAuth, credential-rule presence, actor address/status/approval, and intended issuer/type/exceptions). It excludes ledger index, capture time, balances, fees, and sequence. It is not a hash of every ledger object, and a read followed by a write is not an atomic on-ledger condition.

A timeout or unvalidated receipt is uncertain. The plan is not offered again. B does not have a reconciliation method beyond A's error text, so the controlled demo needs a new process and a new session. A validated receipt whose follow-up read fails is kept, marked uncertain, and not retried.

A's `removeIndividualApproval` only removes the legacy address stored in its own in-process preview, and `createDemoEnvironment` reuses that process session. It does not rebuild the legacy approval after a repair. A new mismatch demo needs a new process.

## Commands

Server, after A's module and its runtime dependencies are installed:

```bash
npm run dev:server
```

Port defaults to `3001` (`PORT`). Optional public metadata directory: `GATECHECK_SESSION_DIR`.

Owned tests, because `package.json` is lead-owned and has no test script:

```bash
npx tsx --test src/server/policy/policy.test.ts src/server/api/aLedger.test.ts src/server/api/api.test.ts
```

Typecheck and build:

```bash
npm run typecheck
npm run build
```

Real HTTP smoke, only against an already-running server, and only when a new faucet run is intended:

```bash
npx tsx src/server/api/smoke.ts --run-real-testnet
```

`GATECHECK_API_URL` defaults to `http://127.0.0.1:3001`. Without the flag the runner exits before creating accounts. This turn did not invoke the flag.

## Real ledger result already recorded

On 2026-10-11 an API process loaded a local checkout of `origin/teammate-a-ledger` (`c0662ea`) and completed one Devnet session (`fc118c09-c727-452b-8639-7327d44ba8b4`):

| Step | Result |
|---|---|
| Setup | DepositAuth on, trusted credential rule present, valid customer `valid`, legacy `revoked` and individually approved, stranger `none` |
| Before | valid `tesSUCCESS` match `61CA36E6…`, legacy `tesSUCCESS` mismatch `F7B89FCB…`, stranger `tecNO_PERMISSION` match `6FC27F7F…` |
| Repair | validated `tesSUCCESS` `A8DCE6B0…`; legacy direct approval removed |
| After | valid `tesSUCCESS` match `3C620D03…`, legacy `tecNO_PERMISSION` match `41DFB3B1…`, stranger `tecNO_PERMISSION` match `3FF83EC4…` |

That run used the previous repair path, which waited for submission before returning `202`. The current path returns `409` for a stale plan before `202`, then submits in the background. No second faucet run was started for that split.

## Checks this turn

`npx tsx --test src/server/policy/policy.test.ts src/server/api/aLedger.test.ts src/server/api/api.test.ts` — 30 passed, 0 failed.

`npm run typecheck` — passed, including the local untracked ledger tree.

`npm run build` — passed.

`npx tsx src/server/api/smoke.ts` without `--run-real-testnet` — exited 1 and did not create accounts.

## Remaining blockers

- `src/server/ledger/**` is not on `api`. The local checkout is untracked and must not be committed from this branch. The lead has to bring A's tree in deliberately. `teammate-a-ledger` has no merge base with `main`.
- Root `package.json` does not depend on `xrpl` 5.3.0 or `dotenv` 16.6.1. A clean install cannot load the ledger module until those are added.
- Gitignore `.private`, `.runtime`, and `GATECHECK_SESSION_DIR`.
- A's in-process demo does not reconstruct the legacy approval after repair, and its removal function accepts only that stored legacy address.
- The smoke runner was not executed against Devnet in this turn.

## Suggested README paragraph

GateCheck's API runs on port 3001 and the Vite client proxies `/api`. Create a session with `approveTestnetSetup: true`, poll `GET /api/sessions/:id` once per second, then run before checks, approve the returned repair plan id, and run after checks. Only literal `true` is approval. A matching blocked payment is a passed check. An inconclusive row is not a block. The repair receipt and the after report are separate. The server talks only to XRPL Devnet or Testnet through the ledger module and never accepts a wallet seed or a client-built transaction.
