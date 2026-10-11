# GateCheck — Teammate A: XRPL integration

**Testnet/Devnet play money only. No production wallets, keys, or funds.**

GateCheck checks whether an XRPL receiver's real payment permissions match its owner's intended policy. This repository portion is the ledger module, not the dashboard or AI. Target tracks: **Most Technically Impressive + Best Use of Ripple**.

## Real counterexample, reproduced

Policy: only customers with an accepted, current credential from the trusted issuer may pay; no direct wallet exceptions.

| Customer | Credential | Direct approval before | Before repair | After repair |
|---|---|---|---|---|
| Alice | Accepted/current | No | `tesSUCCESS` | `tesSUCCESS` |
| Bob | Deleted/revoked | Yes | `tesSUCCESS` (policy violation) | `tecNO_PERMISSION` |
| Charlie | None | No | `tecNO_PERMISSION` | `tecNO_PERMISSION` |

These are **actual validated Devnet transactions**, not mocked results. [evidence/live-demo.json](evidence/live-demo.json) contains setup receipts, before/after payments, native account state, and the approved repair receipt. Evidence is a historical snapshot; public test networks reset and historical availability is not guaranteed.

Alice's payment carries her valid `CredentialIDs`. Bob's payment intentionally omits his revoked credential ID: a deleted ID is invalid regardless of the surviving approval and would test a different condition. His credential deletion and direct `DepositPreauth` entry are independently read from the ledger.

The repair is exactly `DepositPreauth { Account: company, Unauthorize: bob }`. It does not delete credential authorizations or change Alice's access. A saved preview must be explicitly approved before signing; a fresh state fingerprint must match the preview.

## Run

Node.js 22+ required.

```bash
npm ci
cp .env.example .env
npm run check
npm test
npm run connection
npm run demo
# Review evidence/before.json and its exact transaction before approving:
npm run repair -- --plan PLAN_ID --approve --operator YOUR_NAME
```

`demo` reuses five disposable faucet accounts; it deliberately reconstructs the vulnerable fixture, including Bob's old approval. **It never applies the repair automatically.** Re-running `demo` after a repair reintroduces the intentional test defect. `repair` reruns the same three payments and writes the complete evidence.

Generated wallet seeds live only in ignored `.private/wallets.json`; transaction journals and pending plans live in ignored `.runtime/`. Do not upload these directories. Unix file modes are requested; on Windows protect the directory with your user ACL and treat these disposable keys as sensitive. No seed or signed blob is returned from the public module.

All writes require a wallet created by this disposable-account module. Only the official Devnet/Testnet WSS endpoints and their matching network IDs are supported; other endpoints fail closed. Required amendments are checked from the validated Amendments ledger entry before funding. Organizer confirmation of the hackathon endpoint is still a human prerequisite; software checks do not substitute for mentor confirmation.

## Integration

Use [docs/HANDOFF.md](docs/HANDOFF.md) and [src/server/ledger/types.ts](src/server/ledger/types.ts). Aren's original handoff was not provided; these are explicit proposed contracts, not assumed teammate APIs. The public import is `src/server/ledger/index.ts`.

## Scope and limitations

- Direct incoming 1-XRP `Payment` only. DepositAuth is not an outgoing spending limit.
- Receiver stays well above base reserve so the low-balance XRP top-up exception cannot explain Bob's success.
- Checks, escrow, permissioned trading, lending, self/cross-currency payments, and other value-transfer routes are not covered.
- Controlled test accounts are a reconstruction, not a production fork or proof about all production behavior.
- Network/request failures are `INCONCLUSIVE`, never "blocked". Hash, Sequence and LastLedgerSequence are journaled before submission. An unresolved result blocks additional same-account submissions; reconcile the original hash rather than retrying a new payment.
- No production signing, key management service, or AI API is implemented. Deterministic code evaluates outcomes; comparable ideas could be built elsewhere, but this implementation depends on XRPL-native semantics.

## Sources

- [Credentials](https://xrpl.org/docs/concepts/decentralized-storage/credentials)
- [Deposit Authorization and exceptions](https://xrpl.org/docs/concepts/accounts/depositauth)
- [DepositPreauth transaction](https://xrpl.org/docs/references/protocol/transactions/types/depositpreauth)
- [Payment and CredentialIDs](https://xrpl.org/docs/references/protocol/transactions/types/payment)
- [Reliable submission](https://xrpl.org/docs/concepts/transactions/reliable-transaction-submission)

## Integration with B

The four frozen ledger exports are implemented in `src/server/ledger/index.ts`: `createDemoEnvironment`, `readSnapshot`, `sendTestPayment`, and `removeIndividualApproval`. See [docs/COMPATIBILITY-HANDOFF.md](docs/COMPATIBILITY-HANDOFF.md) for selected-file integration, credential guarantees, and the explicit server-side approval boundary.
