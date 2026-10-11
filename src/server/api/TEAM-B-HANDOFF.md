# Teammate B handoff

Repository remote: `https://github.com/its-advait/B-B-Hacks`  
API branch: `api` (from `main` at `b5b7cd2`)  
Ledger branch inspected, not merged: `teammate-a-ledger` at `1fbc28b` (no merge base with `main`)

## Ownership

B edits `src/server/api/**`, `src/server/policy/**`, and `src/server/index.ts`.

A owns `src/server/ledger/**`. The integration lead owns `src/client/**`, `src/shared/contracts.ts`, `package.json`, lockfiles, root config, and `README.md`.

## Ledger adapter

B loads `src/server/ledger/index.ts` at runtime and calls A's actual exports:

`connectLedger`, `createTestAccounts`, `setupPermissions`, `readPermissions`, `readCredential`, `testPayment`, `customerRefs`, `CUSTOMER_TYPE`, `previewRemoveDirectApproval`, `removeDirectApproval`.

Role addresses are `alice` → `validCustomer`, `bob` → `legacyCustomer`, `charlie` → `stranger`, `company` → treasury, `issuer` → issuer. Outcomes are not chosen from those names.

`readCredential({ subject, issuer: snapshot.issuerAddress, credentialType: snapshot.credentialType })` maps to `valid` only when `exists && accepted && !expired && id`. A thrown read is inconclusive. A missing credential is `none` unless this session's `setupPermissions` call validated Bob's credential delete; that is the lifecycle evidence for `revoked`.

Legacy and stranger payments call `testPayment(address, treasury, [])` directly. The generic payment suite is not used. Receipts keep `validated`, `resultCode`, `transactionHash`, `ledgerIndex`, `sender`, `sequence`, and `lastLedgerSequence` on the private session. Public rows receive only the shared observation fields. `resultCode === 'INCONCLUSIVE'` or `successful === null` stays inconclusive, including when a hash is already known.

Repair preview and submission go through A's stored plans. The public plan id and fingerprint are A's. Approval is `removeDirectApproval(planId, { approved: true, planId, approvedBy: 'gatecheck-operator' })`. B does not write a second plan file and does not submit its own `DepositPreauth`. Client transaction JSON is ignored.

A's module is process-global. This API branch does not copy `src/server/ledger/**` or add `xrpl`. When that directory is absent, jobs fail closed.

## Contract gap

The shared `Actor` still has no per-actor issuer, type, acceptance, or expiry. The adapter applies those checks before setting `credentialStatus`. No shared-contract edit was required for this mapping. Direct ledger approvals stay out of `individualExceptions`.

## API that is implemented

| Method | Behavior |
|---|---|
| `GET /api/health` | `{ ok: true, mode: 'testnet' }` |
| `POST /api/sessions` | Requires `approveTestnetSetup: true`. Returns `202 { sessionId }`. |
| `GET /api/sessions/:id` | `PublicSession` |
| `POST /api/sessions/:id/checks` | Requires `phase` `before` or `after` and `approveTestPayments: true`. |
| `POST /api/sessions/:id/repair` | Requires stored `planId` and `approved: true`. Client transaction JSON is ignored. |

Missing approval is 400. Unknown session is 404. A busy session, bad phase, or a repair A's module rejects as stale is 409. After-checks require a validated `tesSUCCESS` repair receipt. The published repair fingerprint is A's permission-state fingerprint. Only validated `tecNO_PERMISSION` counts as blocked. `INCONCLUSIVE` and other non-authorization codes stay inconclusive. One uncertain repair is not resubmitted.

## Scripts

Root scripts, unchanged: `npm run dev`, `npm run dev:server`, `npm run dev:client`, `npm run typecheck`, `npm run build`, `npm start`.

B tests, with no root script because `package.json` is lead-owned:

```bash
npx tsx --test src/server/policy/policy.test.ts src/server/api/aLedger.test.ts src/server/api/api.test.ts
```

## Lead coordination

- Add `"test": "tsx --test src/server/policy/policy.test.ts src/server/api/aLedger.test.ts src/server/api/api.test.ts"` if the team wants one command.
- Do not merge `teammate-a-ledger` into `main` as-is. It has a different history, package, and contract.
- When A's module is integrated, add A's runtime dependency (`xrpl`, currently 5.3.0 on that branch) in the root package. B does not import it.
- Root engines say Node `>=20`. A's branch says Node `>=22`. This checkout used Node 22.

## Checks run here

Policy and adapter tests use an in-memory stand-in for A's exports. They do not submit XRPL transactions. Live setup stays unavailable until `src/server/ledger/index.ts` from `teammate-a-ledger` is present in the same tree and the lead has installed `xrpl`.
