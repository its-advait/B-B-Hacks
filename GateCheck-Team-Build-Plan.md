# GateCheck: three-person hackathon build plan

## Scope and deadline

Start assumption: 1:45 PM. Build complete at 4:15 PM (150 minutes). Submission deadline: 5:15 PM. Submit by 5:00 PM, leaving the required 15-minute submission buffer. If your actual available build window is shorter, preserve the integration and submission buffers and cut features.

Track choices: Most Technically Impressive (the only general track) + Best Use of Ripple. No other sponsor integration for this MVP.

Product: an XRPL payment-permission dashboard that compares a company's intended rules with actual testnet payment outcomes, explains mismatches, and lets an operator approve a specific repair.

This is a controlled testnet prototype. It does not clone arbitrary production accounts, perform identity verification, or prove every XRPL payment route safe. It supports direct incoming Payment transactions in a funded account above its reserve. Never advertise it as an outgoing spending-control tool.

Skip OPA, arbitrary natural-language policy compilation, production wallets, real customer documents, multisign, escrow, DEX, lending, mobile, and extra sponsor tracks. Do not require an LLM API for the demo.

## The complete user journey

1. Operator clicks Create test environment, explicitly approving setup transactions using fake funds.
2. Backend creates five funded test wallets: treasury, trusted credential issuer, valid customer, legacy customer, and stranger. Seeds remain backend-only.
3. Treasury has Deposit Authorization enabled. Both customers initially have accepted credentials from the trusted issuer. Treasury accepts that issuer/type and also has an old direct preauthorization for the legacy customer.
4. Setup revokes the legacy customer's credential. The direct approval remains.
5. UI displays the intended rule: only customers with current, accepted credentials from the configured issuer may make direct payments; no individual exceptions are intended.
6. Operator clicks Run checks, authorizing a small fixed test suite.
7. Valid customer submits a Payment with its valid CredentialIDs: expected allowed.
8. Legacy customer submits a Payment WITHOUT CredentialIDs: expected blocked by business policy, but actual ledger result is success because direct preauthorization remains.
9. Stranger submits a Payment WITHOUT CredentialIDs: expected blocked, and actual ledger result should reject it.
10. UI shows expected versus observed results, validated transaction hashes/result codes, and the direct approval that explains the mismatch.
11. Operator sees and approves removal of the legacy customer's specific preauthorization. UI must say testnet configuration change and show the affected address.
12. Backend submits DepositPreauth with Unauthorize for that address and awaits validation.
13. Rerun the same three checks. Valid customer succeeds; legacy customer and stranger are blocked.

Critical: never attach a deleted credential ID to the legacy customer's test. Invalid supplied credentials can cause rejection before the independent direct approval is demonstrated. Use no CredentialIDs for that customer and for the stranger.

Outcomes must come from actual validated ledger results. A timeout or RPC problem is inconclusive, not a blocked payment. A rejected validated transaction may consume fees. Keep the treasury and test senders comfortably above reserve requirements.

## Technology and file ownership

One repository. One root package.json and lockfile. TypeScript everywhere; React + Vite client; Express server; xrpl SDK; a simple private JSON session store for one local demo process. Do not put seeds in that JSON store: keep them in server memory. Restarting the server invalidates live sessions; expose a clear reset/recreate path. Public report exports contain no seeds. A production architecture is outside this scope.

Frontend on Vite port 5173 proxies /api to Express port 3001. Use relative /api requests. For optional deployment, Express serves built frontend assets from dist/client; use one long-running server process. Do not try to host the ledger job engine as a short-lived serverless function.

| Owner | Files | Deliverable |
|---|---|---|
| Teammate A: ledger engineer | src/server/ledger/** | Actual XRPL setup, reads, payments, and repair transactions |
| Teammate B: API/policy engineer | src/server/api/**, src/server/policy/**, src/server/index.ts | Session jobs, policy evaluation, reports, API and server hosting |
| You: UI/integration lead | src/client/**, src/shared/contracts.ts, root config, README.md | Dashboard, frozen shared contract, repo setup, integration and submission |

Commit the common scaffold before splitting. Teammates do not change src/shared/contracts.ts, package.json, or the lockfile independently; request changes from the integration lead. They may propose dependency additions; lead installs them centrally. Avoid multiple build systems.

## Shared contract: freeze before coding

Create src/shared/contracts.ts with these types and signatures (or copy this block). Internal LedgerSession below is opaque to frontend code.

```ts
export type ActorRole = 'validCustomer' | 'legacyCustomer' | 'stranger';
export type Outcome = 'allowed' | 'blocked' | 'inconclusive';
export type Phase = 'before' | 'after';
export type SessionStatus = 'settingUp' | 'ready' | 'checking' | 'repairing' | 'error';

export interface Actor {
  role: ActorRole;
  address: string;
  credentialStatus: 'valid' | 'revoked' | 'none';
  individuallyApproved: boolean;
}
export interface AccountSnapshot {
  network: string;
  ledgerIndex: number;
  treasuryAddress: string;
  issuerAddress: string;
  credentialType: string;
  depositAuthEnabled: boolean;
  trustedCredentialRulePresent: boolean;
  actors: Actor[];
  capturedAt: string;
}
export interface IntendedPolicy {
  trustedIssuer: string;
  credentialType: string;
  requireCurrentAcceptedCredential: true;
  individualExceptions: string[];
}
export interface PaymentObservation {
  actor: ActorRole;
  observed: Outcome;
  validated: boolean;
  transactionHash?: string;
  resultCode?: string;
  error?: string;
}
export interface CheckRow extends PaymentObservation {
  expected: 'allowed' | 'blocked';
  verdict: 'match' | 'mismatch' | 'inconclusive';
  explanation: string;
}
export interface RepairPlan {
  id: string;
  description: string;
  affectedAddress: string;
  unsignedTransaction: {
    TransactionType: 'DepositPreauth';
    Account: string;
    Unauthorize: string;
  };
  snapshotFingerprint: string;
}
export interface Report {
  id: string;
  phase: Phase;
  snapshot: AccountSnapshot;
  policy: IntendedPolicy;
  rows: CheckRow[];
  repairPlan?: RepairPlan;
  completedAt: string;
}
export interface PublicSession {
  id: string;
  status: SessionStatus;
  network: string;
  progress: string;
  snapshot?: AccountSnapshot;
  reports: Report[];
  repairReceipt?: { transactionHash: string; resultCode: string; validated: true };
  error?: string;
}
```

Ledger exports (A implements; B calls):

```ts
// LedgerSession holds wallets/client internally; never JSON-serialize it.
createDemoEnvironment(onProgress: (message: string) => void): Promise<LedgerSession>
readSnapshot(session: LedgerSession): Promise<AccountSnapshot>
sendTestPayment(session: LedgerSession, actor: ActorRole): Promise<PaymentObservation>
removeIndividualApproval(session: LedgerSession, address: string): Promise<{
  transactionHash: string; resultCode: string; validated: true;
}>
```

Make readSnapshot inspect current ledger state: account flags, DepositPreauth entries, and credential existence/acceptance/issuer information. Do not report successful mutations solely because a function was called. Assert ledger confirmations. Use credential request formats from official XRPL docs and the installed SDK types, not guessed JSON.

B may create a typed fake ledger adapter locally for integration development, but it must be visibly labeled Development fixture and must not be the submitted core. Before and after results cannot be prewritten.

## API contract

| Method/path | Request | Response |
|---|---|---|
| GET /api/health | none | { ok: true, mode: 'testnet' } |
| POST /api/sessions | { approveTestnetSetup: true } | 202 { sessionId } |
| GET /api/sessions/:id | none | PublicSession; poll every second during jobs |
| POST /api/sessions/:id/checks | { phase: 'before' or 'after', approveTestPayments: true } | 202 { sessionId } |
| POST /api/sessions/:id/repair | { planId, approved: true } | 202 { sessionId } |

Errors: { error: { code: string, message: string } }. Missing approval: 400. Unknown session: 404. Another mutation running, stale repair plan, or invalid phase: 409. Unexpected failure: 500.

Jobs start asynchronously; update progress through PublicSession. One mutation at a time per session. Disable overlapping requests in UI and enforce locking in backend. Guard duplicate button clicks.

Repair accepts a stored plan ID, not arbitrary client-supplied transaction JSON. Before executing, read fresh account state and compare relevant settings to the plan fingerprint. If changed, reject the stale plan and require new checks. Fill fee/sequence and current ledger bounds at execution time; a failed or unvalidated repair is not success. Do not reset the treasury account or remove unrelated permissions.

Policy: expected allowed only if the actor has a current accepted credential from the configured issuer/type OR its address is explicitly in intended individualExceptions. The demo has no intended exceptions. Actual ledger individual approval does NOT change the intended policy. Otherwise the test would conceal the mismatch.

Generate the explanation and repair only when a validated allowed observation contradicts intended blocked behavior AND the snapshot shows the corresponding direct approval. The finding must follow observed data. Otherwise explain missing authorization, inconsistency, or insufficient evidence without inventing a repair.

## Task A: Cursor prompt for teammate A

You own GateCheck's real XRPL integration. Read this plan and src/shared/contracts.ts before editing. Work only in src/server/ledger/**. Do not modify root configuration or shared types without coordinating with the lead.

Implement createDemoEnvironment, readSnapshot, sendTestPayment, and removeIndividualApproval with the signatures in this plan. Use TypeScript and the xrpl SDK. Use a public XRPL testnet/devnet that supports Credentials, and verify required amendments before proceeding. Ask the Ripple mentor for the right network immediately if unsupported. Use official XRPL documentation and SDK types.

Create five funded throwaway test accounts: treasury, issuer, valid customer, legacy customer, stranger. Enable Deposit Authorization on treasury, create trusted issuer/type credential preauthorization, issue and accept customer credentials, directly approve legacy customer, then revoke only legacy customer's credential. Keep balances comfortably above reserves. Report setup progress. Keep all wallet seeds in server-only memory; never expose or log them.

Test payments must be tiny fixed XRP amounts and sent sequentially. Valid customer supplies its current accepted credential ID. Legacy customer and stranger supply no CredentialIDs. For every attempted payment return actual validated result code, hash, and allowed/blocked/inconclusive outcome. Handle SDK throws containing a validated ledger rejection without losing the evidence; RPC errors and timeouts are inconclusive. Do not treat every thrown error as authorization failure. Wait for validation of setup and repair transactions.

Read snapshots from current ledger state, not hardcoded roles after mutations. removeIndividualApproval must issue only the specific DepositPreauth Unauthorize transaction and confirm it. Reject unsupported network configuration clearly. Reuse funded sessions rather than repeatedly calling faucets. Deliver an executable backend-only smoke runner with redacted output showing setup -> three before payments -> repair -> three after payments. Commit first working setup/payment flow early, then complete the rest. If Credentials fail by 2:10, tell the team and mentor rather than fabricating behavior.

## Task B: Cursor prompt for teammate B

You own GateCheck's policy evaluator, API orchestration, and report engine. Read this plan and src/shared/contracts.ts. Work in src/server/api/**, src/server/policy/**, and src/server/index.ts. Coordinate with A's ledger signatures; do not edit their files or shared/root config without asking the lead.

Implement the five endpoints specified above in Express. Setup/check/repair jobs run asynchronously and update a PublicSession record polled by UI. Maintain private LedgerSession objects separately from JSON-safe public records. Lock each session against concurrent mutation and duplicate repair requests. Validate approval fields and stage transitions.

Evaluate the intended rule deterministically: valid accepted credential from the configured issuer/type, or a deliberate exception in intended policy. Do not use existing ledger direct approval as a business-policy exception. Compare expectations with real ledger outcomes. Build reports with rows, explanations, snapshot, timestamps, hashes, codes, and verdicts. Preserve inconclusive outcomes for transport failures. Derive legacy-approval finding and repair from actual mismatches plus current snapshot evidence. Never prewrite findings.

Store a server-generated repair plan, derive its fingerprint from sorted relevant account permissions/credential state, and require an approved plan ID. Re-read current state before repair; reject stale plans. Have the ledger adapter execute only the specific stored Unauthorize action. Expose actual receipt after validation. Support a second check report and JSON download via existing session JSON. A development adapter is allowed only behind explicit development configuration and visible labeling; submitted demo uses real ledger execution. Handle errors cleanly and never serialize secrets. Serve production frontend build from Express if time permits. Add meaningful evaluator tests for mismatch, exception, inconclusive result, and matching denial. Commit endpoints with typed fixtures early to unblock UI; replace fixture calls before demo.

## Task C: Cursor prompt for you

You own GateCheck's frontend and integration. Create/freeze src/shared/contracts.ts and the shared root scaffold first, then work in src/client/**. Use React + Vite + TypeScript and simple CSS; avoid adding a UI library unless already installed. Backend API is specified in this plan. Use /api relative paths and a Vite proxy to localhost:3001.

Build one dashboard, not multiple marketing pages. Include a prominent Testnet / fake funds label; setup action with explicit approval; current treasury address/network/permissions and actor statuses; intended policy; Run checks action; expected-versus-observed table with real result codes and transaction hashes; mismatch explanation; exact repair preview and explicit confirmation; Rerun checks; before/after tabs; connection/progress/errors; and JSON report download that contains no secrets. Poll session state every second during jobs and stop on completion. Buttons must reflect valid stages and disable during mutations. Actual transaction links use the selected network's explorer only if known; otherwise show/copy the hash.

Use a development fixture only to build layout before backend exists, clearly marked, and remove it from the submitted demo path. Do not assume any outcome is always green or red. Display inconclusive results separately. Do not collect production seeds. Settings are deliberately scoped to the supported workflow; do not build arbitrary policy editing, an LLM chat, or unrelated XRPL tabs.

As integration lead, own package.json/lockfile, root config, README and main branch merges. Write setup instructions, architecture, supported behavior/limits, team credits, and public report redaction rules. Help test a clean clone. Record a <=2-minute video with the real workflow, upload to YouTube, and submit the public repo plus video link. Live deployment is recommended, not mandatory.

## Repository collaboration

Create a PUBLIC GitHub repo immediately and add both teammates as collaborators. Lead pushes scaffold and this plan, then everyone clones the same repository. Use branches ledger, api, ui. Do not wait until the end to upload separate folders or ZIPs. Shared contracts and early pushes make integration possible while work is ongoing.

Each member:

```bash
git clone <shared-repo-url>
cd <repo-folder>
git switch -c <ledger-or-api-or-ui>
npm install
```

Commit and push a small working increment:

```bash
git add <your-owned-paths>
git commit -m "Implement initial module"
git push -u origin <your-branch>
```

Lead reviews/merges branches sequentially, preserving shared contract. Teammates pull merged main into their branches after integration updates. Never force-push shared main. A is owner of actual ledger behavior; B is owner of API state; lead is owner of shared contracts and dependencies.

Lead root scripts should provide npm run dev, npm run build, npm start, and npm run typecheck. Have one install and one documented start path. Vite development and Express can run via concurrently; build frontend and backend into distinct output folders. Choose module settings consistently before coding.

## Timeline

| Time | Gate |
|---|---|
| 1:45-1:55 | Public repo, collaborator invites, scaffold, shared types and ownership agreed |
| 1:55-2:10 | A verifies network/credentials and one real transaction; B exposes endpoints with explicit fixtures; C renders dashboard |
| 2:10-2:35 | A completes environment and before tests; B builds policy/report; C wires setup/polling/results |
| 2:35-2:50 | Merge early; first browser -> API -> real XRPL -> report flow |
| 2:50-3:20 | Specific repair and after checks; review UI and stale-plan handling |
| 3:20-3:45 | Full integrated run; fix real failures; export report and clear fixture mode |
| 3:45-4:15 | Feature freeze; clean-clone instructions, type/build checks, final demo rehearsal |
| 4:15-4:45 | Record <=2-minute YouTube demo; optional deploy only if working |
| 4:45-5:00 | Verify public repo/video access; submit via hackathoncompany.com/platform |
| 5:00-5:15 | Submission confirmation/buffer |

Do not spend the remaining window adding sponsor bonuses. At 2:50, if repair is blocked, preserve real before findings and a reviewable unsigned repair plan rather than mock repair success. At 2:10, if credentials are unavailable, ask the mentor for a supported devnet. If still unavailable, narrow openly to direct wallet approval/revocation and label credential support unavailable; this has lower technical depth but preserves real functionality. No fake outcomes or hidden hardcoded reports.

## Acceptance checks and submission

- New isolated session can be created; all setup transactions validated.
- Before: valid allowed/match; legacy allowed/mismatch; stranger blocked/match, assuming stated settings and sufficient balances.
- Finding follows observed outcome and direct-approval state.
- Repair requires confirmation and removes only the reviewed address approval.
- After: valid allowed/match; legacy blocked/match; stranger blocked/match.
- Refresh/poll/API errors behave clearly; timeouts do not masquerade as denied payments.
- Public repo includes all code and instructions; no real or test seeds, env files, or secret reports in Git history.
- Demo uses actual testnet backend, real transactions, and no development fixtures.
- Functionality built during hackathon; existing libraries credited. Core functionality is not hardcoded.
- Choose exactly one general track: Most Technically Impressive. Also select Ripple.
- Required recorded YouTube demo is 2 minutes MAX. Public GitHub repo is required. Deployment recommended only.
- Allow 15 minutes for submission. Submit by 5:00 for a 5:15 deadline.

## 110-second demo script

0-15s: A company's intended rule is that only currently credentialed customers can pay. GateCheck checks whether their XRPL settings agree.

15-35s: Show actual account settings and before report. Valid customer succeeds, stranger is rejected, but a customer whose credential was revoked still succeeds.

35-55s: Open the counterexample: an old direct wallet approval still exists. Show real validated transaction evidence and the intended-policy mismatch.

55-75s: Review the specific Unauthorize transaction, approve it, and show the validated repair receipt. Cut waiting time in the recording if necessary; label cuts and do not fabricate updates.

75-100s: Show real after report: the revoked customer is blocked, valid customer can still pay. Explain the owner kept control.

100-110s: GateCheck is a reusable permission dashboard with real XRPL regression tests. Show public repo and supported scope. Passing these cases is not proof of all ledger behavior.
