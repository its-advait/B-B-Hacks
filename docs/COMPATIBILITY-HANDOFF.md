# Teammate A → Teammate B compatibility handoff

Branch: `teammate-a-ledger`. The four frozen exports are the primary integration surface;
the original lower-level exports remain on the same module.

## Frozen exports (`src/server/ledger/index.ts`)

```ts
createDemoEnvironment(onProgress: (message: string) => void): Promise<LedgerSession>
readSnapshot(session: LedgerSession): Promise<AccountSnapshot>
sendTestPayment(session: LedgerSession, actor: ActorRole): Promise<PaymentObservation>
removeIndividualApproval(session: LedgerSession, address: string): Promise<{ transactionHash: string; resultCode: string; validated: true }>
```

`AccountSnapshot`, `ActorRole`, `Actor` and `PaymentObservation` are the shared types from
`src/shared/contracts.ts`. `LedgerSession` is an **opaque, in-process handle**. It is created
only by `createDemoEnvironment` and carries no seeds, no signed blobs and no serializable
authority: a forged or serialized object is rejected with `Unknown ledger session`. B must
hold the handle returned by `createDemoEnvironment`; it must not persist or reconstruct it.

## Actor mapping

| Shared role | Ledger role |
|---|---|
| `validCustomer` | `alice` |
| `legacyCustomer` | `bob` |
| `stranger` | `charlie` |
| (treasury) | `company` |

`ACTOR_MAPPING` is exported for assertions. `sendTestPayment` rejects any other actor.

## `credentialStatus: "valid"` guarantees

`credentialStatus` returns `valid` only when **all** of the following hold against the
same credential object read from the validated ledger:

- `subject` equals the actor address,
- `issuer` equals the configured trusted issuer,
- `credentialType` equals the configured customer credential type (case-insensitive),
- the credential exists and is `accepted` (accepted-flag set),
- it has a concrete ledger entry id,
- it is **not** expired (`Expiration` absent or `>=` validated close time).

If the credential exists but is unaccepted, expired or has no entry id, the snapshot raises
rather than guessing — an incomplete read must never be reported as `valid`. A missing
credential is `none`, or `revoked` **only** when setup recorded a validated
`CredentialDelete` for that subject (`revokedSubjects`). Revocation is proven from the
returned receipt, never inferred from a role name.

## Payments

- `validCustomer` pays with its validated `CredentialIDs` when the credential is valid.
- `legacyCustomer` and `stranger` always omit `CredentialIDs`, even if an object is visible.
- Only a validated `tesSUCCESS` is `allowed`; only validated `tecNO_PERMISSION` is `blocked`.
  Any other code, or an unvalidated/timeout result, is `inconclusive` and keeps its hash and
  result code.

## Repair boundary (reviewed safeguards preserved)

`readSnapshot` internally previews the exact `DepositPreauth { Account: company,
Unauthorize: legacy }` plan against the current permission fingerprint. `removeIndividualApproval`
is the **approval action itself**: it reuses the stored preview because the frozen two-argument
signature cannot carry an independent approval token. It requires the stored plan to exist and
to target the same address, revalidates fingerprint/expiry/network inside `removeDirectApproval`,
submits only the reviewed transaction, refuses stale/reused plans, and returns the real receipt.
A non-`tesSUCCESS` or unvalidated repair throws and is not resubmitted. Never call this function
from evaluation or a read path.

## Required dependencies and configuration

- Node.js **>= 22**.
- Runtime deps: `xrpl` **5.3.0**, `dotenv` **16.6.1**.
- `.env`: `XRPL_URL` — official Devnet/Testnet WSS only (`wss://s.devnet.rippletest.net:51233`
  default), optional `GATECHECK_NETWORK` must match, optional `GATECHECK_RUNTIME_DIR`
  (defaults to `.runtime`, holds journal and stored plans; keep it out of version control).
- Only official Devnet/Testnet WSS endpoints and matching network IDs are accepted; other
  endpoints fail closed. Verified amendments: Credentials, DepositAuth, DepositPreauth.

## Selected-file integration

Take `src/server/ledger/**` (including `compatibility.ts`) and `src/shared/contracts.ts`.
`src/shared/contracts.ts` on this branch is **byte-identical to `main`**, so it is a no-op on
integration and exists only so the branch typechecks standalone. No `main` file was edited.

## Verification result (real Devnet, network ID 2)

Live run on 2026-10-11 against validated Devnet:

- Snapshot: `validCustomer` → `credentialStatus: "valid"`, `legacyCustomer` → `"revoked"`
  with `individuallyApproved: true`, `stranger` → `"none"`.
- `sendTestPayment`: `validCustomer` `allowed` `tesSUCCESS`; `legacyCustomer` `allowed`
  `tesSUCCESS` (individually approved); `stranger` `blocked` `tecNO_PERMISSION`. No repair was
  submitted during the compatibility check.
- Raw capture: [evidence/compatibility-before.json](evidence/compatibility-before.json).
- `npm run check` (strict `tsc --noEmit`) and `npm test` (11 tests) pass.

Historical end-to-end evidence — including the approved Bob-only Unauthorize repair and the
after-repair suite — is in [evidence/live-demo.json](evidence/live-demo.json).
