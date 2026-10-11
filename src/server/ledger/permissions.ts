import { createHash } from 'node:crypto'
import { AccountSetAsfFlags, xrpToDrops } from 'xrpl'
import { client } from './client.js'
import { CUSTOMER_TYPE, acceptCredential, issueCredential, readCredential, revokeCredential } from './credentials.js'
import { requireSuccess, submitTransaction } from './transactions.js'
import type { Accounts, CredentialRef, Permissions, TransactionResult } from './types.js'

export function permissionFingerprint(data: Pick<Permissions, 'account' | 'flags' | 'directApprovals' | 'credentialApprovals' | 'credentials'>): string {
  // Ignore balance and close time: unrelated payments must not invalidate a plan.
  const stable = {
    account: data.account, flags: data.flags,
    direct: [...data.directApprovals].sort((a, b) => a.ledgerEntryId.localeCompare(b.ledgerEntryId)),
    credential: [...data.credentialApprovals].sort((a, b) => a.ledgerEntryId.localeCompare(b.ledgerEntryId)),
    subjects: [...data.credentials].sort((a, b) => a.subject.localeCompare(b.subject)),
  }
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex')
}
export async function readPermissions(account: string, refs: CredentialRef[] = []): Promise<Permissions> {
  const info = await client.request({ command: 'account_info', account, ledger_index: 'validated' })
  const index = info.result.ledger_index
  if (!index) throw new Error('No validated ledger index')
  const ledger = await client.request({ command: 'ledger', ledger_index: index })
  const server = await client.request({ command: 'server_info' })
  const directApprovals: Permissions['directApprovals'] = []
  const credentialApprovals: Permissions['credentialApprovals'] = []
  let marker: unknown
  do {
    const page = await client.request({ command: 'account_objects', account, ledger_index: index, type: 'deposit_preauth', limit: 200, ...(marker === undefined ? {} : { marker }) })
    for (const entry of page.result.account_objects) {
      if (entry.LedgerEntryType !== 'DepositPreauth') continue
      if ('Authorize' in entry && typeof entry.Authorize === 'string') directApprovals.push({ account: entry.Authorize, ledgerEntryId: entry.index })
      if ('AuthorizeCredentials' in entry && entry.AuthorizeCredentials) {
        credentialApprovals.push({ ledgerEntryId: entry.index, credentials: entry.AuthorizeCredentials.map(c => ({ issuer: c.Credential.Issuer, credentialType: c.Credential.CredentialType })) })
      }
    }
    marker = page.result.marker
  } while (marker !== undefined)
  const credentials = await Promise.all(refs.map(ref => readCredential(ref, index)))
  const permissions: Permissions = {
    account, ledgerIndex: index, ledgerHash: ledger.result.ledger_hash,
    flags: info.result.account_data.Flags, depositAuth: (info.result.account_data.Flags & 0x01000000) !== 0,
    balanceDrops: info.result.account_data.Balance,
    baseReserveDrops: xrpToDrops(String(server.result.info.validated_ledger?.reserve_base_xrp ?? (() => { throw new Error('Server did not report validated reserve') })())),
    directApprovals, credentialApprovals, credentials, fingerprint: '',
    limitations: ['Only direct incoming XRP Payment transactions are tested.', 'DepositAuth is not an outgoing spending control.', 'Low-balance reserve top-ups can bypass DepositAuth; demo requires receiver balance above reserve.', 'Checks, escrow, trading, lending, and other value-transfer paths are outside this suite.', 'Controlled test accounts are a reconstruction, not a production ledger fork.'],
  }
  permissions.fingerprint = permissionFingerprint(permissions)
  return permissions
}
export function customerRefs(accounts: Accounts): CredentialRef[] {
  return ['alice', 'bob', 'charlie'].map(role => ({ subject: accounts[role as 'alice' | 'bob' | 'charlie'], issuer: accounts.issuer, credentialType: CUSTOMER_TYPE }))
}
export async function setupPermissions(accounts: Accounts): Promise<{ receipts: TransactionResult[]; permissions: Permissions }> {
  const receipts: TransactionResult[] = []
  let state = await readPermissions(accounts.company)
  if (BigInt(state.balanceDrops) <= BigInt(state.baseReserveDrops) + 10_000_000n) throw new Error('Fund receiver above reserve to exclude DepositAuth top-up exception')
  if (!state.depositAuth) receipts.push(requireSuccess(await submitTransaction({ TransactionType: 'AccountSet', Account: accounts.company, SetFlag: AccountSetAsfFlags.asfDepositAuth })))
  const alice: CredentialRef = { subject: accounts.alice, issuer: accounts.issuer, credentialType: CUSTOMER_TYPE }
  const bob: CredentialRef = { ...alice, subject: accounts.bob }
  for (const ref of [alice, bob]) {
    let credential = await readCredential(ref)
    if (!credential.exists) { receipts.push(await issueCredential(ref)); credential = await readCredential(ref) }
    if (!credential.accepted) receipts.push(await acceptCredential(ref))
  }
  state = await readPermissions(accounts.company)
  if (!state.credentialApprovals.some(rule => rule.credentials.length === 1 && rule.credentials[0]?.issuer === accounts.issuer && rule.credentials[0]?.credentialType === CUSTOMER_TYPE)) {
    receipts.push(requireSuccess(await submitTransaction({ TransactionType: 'DepositPreauth', Account: accounts.company, AuthorizeCredentials: [{ Credential: { Issuer: accounts.issuer, CredentialType: CUSTOMER_TYPE } }] })))
  }
  if (!state.directApprovals.some(rule => rule.account === accounts.bob)) receipts.push(requireSuccess(await submitTransaction({ TransactionType: 'DepositPreauth', Account: accounts.company, Authorize: accounts.bob })))
  receipts.push(await revokeCredential(bob))
  const permissions = await readPermissions(accounts.company, customerRefs(accounts))
  if (permissions.directApprovals.some(rule => rule.account === accounts.alice || rule.account === accounts.charlie)) throw new Error('Unexpected direct approval makes the fixture invalid')
  return { receipts, permissions }
}
