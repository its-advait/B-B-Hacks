import type { AccountSnapshot, Actor, ActorRole, PaymentObservation } from '../../shared/contracts.js'
import { createTestAccounts } from './accounts.js'
import { connectLedger } from './client.js'
import { CUSTOMER_TYPE, readCredential } from './credentials.js'
import { customerRefs, readPermissions, setupPermissions } from './permissions.js'
import { testPayment } from './payments.js'
import { previewRemoveDirectApproval, removeDirectApproval } from './repair.js'
import type { Accounts, CredentialState, NetworkProof, Permissions, RepairPlan, TransactionResult } from './types.js'

export interface LedgerSession { readonly kind: 'gatecheck-private-session' }
interface PrivateSession {
  accounts: Accounts
  network: NetworkProof
  revokedSubjects: Set<string>
  reviewedPlan: RepairPlan | null
  busy: boolean
}
const sessions = new WeakMap<object, PrivateSession>()
let environment: Promise<LedgerSession> | undefined
export const ACTOR_MAPPING = { validCustomer: 'alice', legacyCustomer: 'bob', stranger: 'charlie' } as const

function privateSession(session: unknown): PrivateSession {
  if (typeof session !== 'object' || session === null) throw new Error('Unknown ledger session')
  const state = sessions.get(session)
  if (!state) throw new Error('Unknown ledger session')
  return state
}
export function credentialStatus(credential: CredentialState, subject: string, issuer: string, type: string, revoked: boolean): Actor['credentialStatus'] {
  if (credential.subject !== subject || credential.issuer !== issuer || credential.credentialType.toUpperCase() !== type.toUpperCase()) throw new Error('Credential subject/issuer/type does not match snapshot')
  if (!credential.exists) return revoked ? 'revoked' : 'none'
  if (!credential.id || !credential.accepted || credential.expired) throw new Error('Shared snapshot cannot represent an unaccepted, expired, or incomplete credential; status is inconclusive')
  return 'valid'
}
export function paymentObservation(actor: ActorRole, receipt: TransactionResult): PaymentObservation {
  const observed = !receipt.validated ? 'inconclusive' : receipt.resultCode === 'tesSUCCESS' ? 'allowed' : receipt.resultCode === 'tecNO_PERMISSION' ? 'blocked' : 'inconclusive'
  return { actor, observed, validated: receipt.validated, transactionHash: receipt.transactionHash, resultCode: receipt.resultCode, ...(receipt.error ? { error: receipt.error } : {}) }
}
export function snapshotFromPermissions(state: PrivateSession, permission: Permissions): AccountSnapshot {
  const { accounts } = state
  if (permission.directApprovals.some(rule => ![accounts.alice, accounts.bob, accounts.charlie].includes(rule.account))) throw new Error('Unsupported direct approval outside the three-actor shared snapshot')
  const rules = permission.credentialApprovals
  if (rules.some(rule => rule.credentials.length !== 1 || rule.credentials[0]?.issuer !== accounts.issuer || rule.credentials[0]?.credentialType.toUpperCase() !== CUSTOMER_TYPE.toUpperCase())) throw new Error('Unsupported issuer/type or credential set outside shared snapshot')
  if (BigInt(permission.balanceDrops) <= BigInt(permission.baseReserveDrops) + 10_000_000n) throw new Error('Treasury must stay above reserve to exclude DepositAuth top-up exceptions')
  const actors = Object.entries(ACTOR_MAPPING).map(([role, original]) => {
    const address = accounts[original]
    const credential = permission.credentials.find(item => item.subject === address && item.issuer === accounts.issuer && item.credentialType.toUpperCase() === CUSTOMER_TYPE.toUpperCase())
    if (!credential) throw new Error('Snapshot credential read incomplete; do not infer none from an RPC failure')
    return { role: role as ActorRole, address, credentialStatus: credentialStatus(credential, address, accounts.issuer, CUSTOMER_TYPE, state.revokedSubjects.has(address)), individuallyApproved: permission.directApprovals.some(rule => rule.account === address) }
  })
  return { network: state.network.network, ledgerIndex: permission.ledgerIndex, treasuryAddress: accounts.company, issuerAddress: accounts.issuer, credentialType: CUSTOMER_TYPE, depositAuthEnabled: permission.depositAuth, trustedCredentialRulePresent: rules.length > 0, actors, capturedAt: new Date().toISOString() }
}
export async function createDemoEnvironment(onProgress: (message: string) => void): Promise<LedgerSession> {
  if (environment) { onProgress('Reusing funded private demo session; no fixture reconstruction.'); return environment }
  environment = (async () => {
    onProgress('Verifying Credentials, DepositAuth, and DepositPreauth on the validated test ledger.')
    const network = await connectLedger()
    onProgress('Loading reusable disposable accounts; signing secrets remain server-side.')
    const accounts = await createTestAccounts()
    onProgress('Configuring credential authorization and the surviving legacy wallet approval; awaiting validation.')
    const setup = await setupPermissions(accounts)
    // setupPermissions only returns after its final issuer-signed CredentialDelete
    // validated tesSUCCESS. This is revocation evidence, not a role-name inference.
    if (!setup.receipts.at(-1)?.validated || setup.receipts.at(-1)?.resultCode !== 'tesSUCCESS') throw new Error('Revocation not validated')
    const session: LedgerSession = Object.freeze({ kind: 'gatecheck-private-session' })
    sessions.set(session, { accounts, network, revokedSubjects: new Set([accounts.bob]), reviewedPlan: null, busy: false })
    await readSnapshot(session)
    onProgress('Ready: accepted valid customer, proven revoked legacy customer, and stranger. Test funds only.')
    return session
  })()
  try { return await environment }
  catch (error) { environment = undefined; throw error }
}
export async function readSnapshot(session: unknown): Promise<AccountSnapshot> {
  const state = privateSession(session)
  const permission = await readPermissions(state.accounts.company, customerRefs(state.accounts))
  const snapshot = snapshotFromPermissions(state, permission)
  const legacy = snapshot.actors.find(actor => actor.role === 'legacyCustomer')
  if (!state.reviewedPlan && snapshot.depositAuthEnabled && legacy?.individuallyApproved && legacy.credentialStatus !== 'valid') {
    // Internal immutable preview binds the exact transaction to full supported
    // permission state. B separately displays/stores its public review plan.
    state.reviewedPlan = await previewRemoveDirectApproval(state.accounts.company, legacy.address, customerRefs(state.accounts))
  }
  return snapshot
}
export async function sendTestPayment(session: unknown, actor: ActorRole): Promise<PaymentObservation> {
  const state = privateSession(session)
  if (!(actor in ACTOR_MAPPING)) throw new Error('Unknown actor role')
  if (state.busy) throw new Error('Ledger session already has a mutation in progress')
  state.busy = true
  try {
    const address = state.accounts[ACTOR_MAPPING[actor]]
    let ids: string[] = []
    // Legacy/stranger NEVER carry CredentialIDs, even if later credentialed.
    if (actor === 'validCustomer') {
      const credential = await readCredential({ subject: address, issuer: state.accounts.issuer, credentialType: CUSTOMER_TYPE })
      if (credentialStatus(credential, address, state.accounts.issuer, CUSTOMER_TYPE, false) === 'valid' && credential.id) ids = [credential.id]
    }
    return paymentObservation(actor, await testPayment(address, state.accounts.company, ids))
  } catch {
    // Submission helper preserves known hashes. Pre-submission RPC failures
    // have no transaction identity and must not become a rejection.
    return { actor, observed: 'inconclusive', validated: false, resultCode: 'INCONCLUSIVE', error: 'Ledger request failed or credential state unsupported; reconcile the server journal before retrying.' }
  } finally { state.busy = false }
}
/** Trusted server execution boundary: B must call ONLY after its stored-plan,
 * explicit approved:true, policy fingerprint, phase and duplicate checks.
 * The fixed two-argument contract cannot carry an independent approval token.
 * Calling this function is the approval action; never call it from evaluation.
 */
export async function removeIndividualApproval(session: unknown, address: string): Promise<{ transactionHash: string; resultCode: string; validated: true }> {
  const state = privateSession(session)
  if (state.busy) throw new Error('Ledger session already has a mutation in progress')
  const plan = state.reviewedPlan
  if (!plan || plan.target !== address || address !== state.accounts.bob) throw new Error('No stored reviewed legacy-approval removal for this address')
  state.busy = true
  try {
    const result = await removeDirectApproval(plan.id, { approved: true, planId: plan.id, approvedBy: 'B approved repair execution boundary' })
    if (!result.receipt.validated || result.receipt.resultCode !== 'tesSUCCESS') throw new Error(`Repair inconclusive or failed; reconcile ${result.receipt.transactionHash} (${result.receipt.resultCode}) before retrying`)
    return { transactionHash: result.receipt.transactionHash, resultCode: result.receipt.resultCode, validated: true }
  } finally { state.reviewedPlan = null; state.busy = false }
}
