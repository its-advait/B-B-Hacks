# Teammate B handoff

Repository remote: `https://github.com/its-advait/B-B-Hacks`  
API branch: `api` (from `main` at `b5b7cd2`)  
Ledger branch inspected, not merged: `teammate-a-ledger` at `1fbc28b` (no merge base with `main`)

## Ownership

B edits `src/server/api/**`, `src/server/policy/**`, and `src/server/index.ts`.

A owns `src/server/ledger/**`. The integration lead owns `src/client/**`, `src/shared/contracts.ts`, `package.json`, lockfiles, root config, and `README.md`.

## Agreed ledger import

B loads `src/server/ledger/index.ts` at runtime (`../ledger/index.js` from the API). The live server calls only these exports:

```ts
createDemoEnvironment(onProgress): Promise<LedgerSession>
readSnapshot(session): Promise<AccountSnapshot>
sendTestPayment(session, actor): Promise<PaymentObservation>
removeIndividualApproval(session, address): Promise<{ transactionHash, resultCode, validated: true }>
```

`LedgerSession` stays inside the API process and is never JSON-encoded. If the module or any of those functions is missing, jobs fail with an unavailable error. They are not replaced with a successful fixture.

## What A's branch actually exports

`teammate-a-ledger:src/server/ledger/index.ts` exports `connectLedger`, `disconnectLedger`, `createTestAccounts`, `setupPermissions`, `readPermissions`, `issueCredential`, `acceptCredential`, `revokeCredential`, `readCredential`, `testPayment`, `runPaymentSuite`, `previewRemoveDirectApproval`, and `removeDirectApproval`. Those names are not wired. A's suggested routes (`/api/setup`, `/api/permissions`, `/api/tests`, `/api/repair/preview`, `/api/repair/approve`) are not the frozen API.

Roles on that branch are `company`, `issuer`, `alice`, `bob`, and `charlie`, not `validCustomer`, `legacyCustomer`, and `stranger`. Repair there stores its own plan and requires `removeDirectApproval(planId, { approved, planId, approvedBy })`.

## Contract gap that needs A's confirmation

`Actor.credentialStatus` has no per-actor issuer, type, acceptance, or expiry. B treats `valid` as a current accepted credential from `AccountSnapshot.issuerAddress` and `AccountSnapshot.credentialType`. `revoked` and `none` are not allowed unless the address is in `IntendedPolicy.individualExceptions`.

A's current `CredentialState` can express issuer, type, accepted, and expiry, but a missing credential object cannot by itself prove revocation. A's demo deletes Bob's credential. B will not relabel that as `revoked` or `valid` from the role name.

If A cannot make the `valid` guarantee, the lead needs to extend `Actor` in `src/shared/contracts.ts` with:

```ts
credentialIssuer: string | null;
credentialType: string | null;
credentialAccepted: boolean;
credentialExpired: boolean;
```

B has not added those fields. Expected outcomes would then have to be re-checked against them.

Direct ledger approvals stay out of intended policy. The demo policy is the snapshot issuer and type plus `individualExceptions: []`.

## API that is implemented

| Method | Behavior |
|---|---|
| `GET /api/health` | `{ ok: true, mode: 'testnet' }` |
| `POST /api/sessions` | Requires `approveTestnetSetup: true`. Returns `202 { sessionId }`. |
| `GET /api/sessions/:id` | `PublicSession` |
| `POST /api/sessions/:id/checks` | Requires `phase` `before` or `after` and `approveTestPayments: true`. |
| `POST /api/sessions/:id/repair` | Requires stored `planId` and `approved: true`. Client transaction JSON is ignored. |

Missing approval is 400. Unknown session is 404. A busy session, bad phase, or stale plan is 409. After-checks require a validated `tesSUCCESS` repair receipt. Fingerprints cover DepositAuth, direct preauthorizations, issuer, credential type, credential status, network, and intended-policy outcome fields. They omit ledger index, snapshot time, balances, sequence, and fees. Only validated `tecNO_PERMISSION` counts as blocked. Other failures stay inconclusive. One uncertain repair is not resubmitted.

## Scripts

Root scripts, unchanged: `npm run dev`, `npm run dev:server`, `npm run dev:client`, `npm run typecheck`, `npm run build`, `npm start`.

B tests, with no root script because `package.json` is lead-owned:

```bash
npx tsx --test src/server/policy/policy.test.ts src/server/api/api.test.ts
```

## Lead coordination

- Add `"test": "tsx --test src/server/policy/policy.test.ts src/server/api/api.test.ts"` if the team wants one command.
- Do not merge `teammate-a-ledger` into `main` as-is. It has a different history, package, and contract.
- When A's module is integrated, add A's runtime dependency (`xrpl`, currently 5.3.0 on that branch) in the root package. B does not import it.
- Root engines say Node `>=20`. A's branch says Node `>=22`. This checkout used Node 22.

## Checks run here

Policy and API tests use an in-memory adapter. They do not submit XRPL transactions. Live setup stays unavailable until A exports the four agreed functions from `src/server/ledger/index.ts`.
