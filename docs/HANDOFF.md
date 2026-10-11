# Teammate A → Teammate B ledger handoff

Public module: `src/server/ledger/index.ts`. All public types are defined in `types.ts` and re-exported. Node 22+, `xrpl` 5.3.0, TypeScript strict, ESM.

```ts
connectLedger(): Promise<NetworkProof>
disconnectLedger(): Promise<void>
createTestAccounts(): Promise<Accounts> // address strings only; five roles
setupPermissions(accounts: Accounts): Promise<{ receipts: TransactionResult[]; permissions: Permissions }>
readPermissions(company: string, refs?: CredentialRef[]): Promise<Permissions>
issueCredential(ref: CredentialRef): Promise<TransactionResult>
acceptCredential(ref: CredentialRef): Promise<TransactionResult>
revokeCredential(ref: CredentialRef): Promise<TransactionResult>
readCredential(ref: CredentialRef, ledgerIndex?: number | 'validated'): Promise<CredentialState>
testPayment(sender: string, company: string, credentialIds?: string[]): Promise<TransactionResult>
runPaymentSuite(accounts: Accounts, policy?: TestPolicy): Promise<PaymentCase[]>
previewRemoveDirectApproval(company: string, target: string, refs?: CredentialRef[]): Promise<RepairPlan>
removeDirectApproval(planId: string, approval: RepairApproval): Promise<RepairResult>
```

`Accounts = { company, alice, bob, charlie, issuer }`, all strings, never Wallet objects. `CredentialRef = { subject, issuer, credentialType }`; type is hexadecimal, exported `CUSTOMER_TYPE` identifies our customer credential. `customerRefs(accounts)` returns the three known test-subject references.

## Receipt contract

```ts
interface TransactionResult {
  transactionHash: string; // known before submission, retained on uncertainty
  validated: boolean;
  resultCode: string; // actual meta.TransactionResult, or INCONCLUSIVE
  successful: boolean | null; // true=validated tesSUCCESS, false=validated failure, null=unknown
  ledgerIndex: number | null;
  sender: string;
  sequence: number;
  lastLedgerSequence: number;
  error?: string;
}
```

Never turn an HTTP failure, thrown error, timeout or `successful: null` into a blocked-payment finding. Only validated `tecNO_PERMISSION` demonstrates the intended authorization rejection. Other failure codes are different failures and must be displayed verbatim. Setup throws if a required transaction is not validated `tesSUCCESS`.

## Review-before-sign flow

1. Call `previewRemoveDirectApproval(company, bob, customerRefs(accounts))`.
2. Show its exact `transaction`, affected wallet, summary, expiry, network and state fingerprint.
3. Wait for an explicit operator click. Pass only the saved `planId`, not a client-supplied transaction.
4. Call `removeDirectApproval(planId, { approved: true, planId, approvedBy: 'operator name' })`.
5. Module loads the saved plan, rereads state, rejects stale/expired/reused previews, and submits only the reviewed transaction.
6. Inspect the receipt and reread state. Run `runPaymentSuite(accounts)` again; compare the same expectations.

Backend MUST serialize test mutations, restrict callers, check Origin for browser mutations and expose no seeds. Teammate A's CLI/module runs locally, not as a production-authenticated API. A returned `approvedBy` string is audit context, not authentication.

## Permission read contract

`Permissions` contains company flags, `depositAuth`, balance/reserve, every direct/credential preauthorization (paginated at one ledger), relevant known credentials, a state fingerprint, ledger index/hash and scope limitations. Relevant credentials must be supplied as refs; this does not enumerate every credential of every potential payer.

## Demo fixture semantics

Setup deliberately issues and accepts Alice/Bob credentials, adds issuer/type preauthorization, adds Bob's direct approval, deletes Bob's credential. Charlie has neither. Reconstructing this fixture is an explicit test setup action; do not call it after every read because it reintroduces the defect.

## Integration endpoints (suggested, not assumed)

- `POST /api/setup` → fixture addresses and validated setup receipts.
- `GET /api/permissions` → actual current state.
- `POST /api/tests` → saved structured policy's expectations vs actual payment results.
- `POST /api/repair/preview` → saved `RepairPlan`, no submission.
- `POST /api/repair/approve` `{ planId, approved: true, approvedBy }` → `RepairResult` and rerun suite.

Network proof and real transactions were verified on Devnet. No mentor handoff or organizer endpoint confirmation was available. See historical hashes in `evidence/live-demo.json`.
