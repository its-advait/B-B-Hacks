import { convertStringToHex } from 'xrpl'
import { client } from './client.js'
import { requireSuccess, submitTransaction } from './transactions.js'
import type { CredentialRef, CredentialState, TransactionResult } from './types.js'

export const CUSTOMER_TYPE = convertStringToHex('gatecheck:customer:v1')
export async function readCredential(ref: CredentialRef, ledgerIndex: number | 'validated' = 'validated'): Promise<CredentialState> {
  const ledger = await client.request({ command: 'ledger', ledger_index: ledgerIndex })
  // Unaccepted credentials are owned by issuer; accepted ones by subject.
  for (const account of new Set([ref.subject, ref.issuer])) {
    let marker: unknown
    do {
      const page = await client.request({ command: 'account_objects', account, ledger_index: ledger.result.ledger_index, type: 'credential', limit: 200, ...(marker === undefined ? {} : { marker }) })
      for (const node of page.result.account_objects) {
        if (node.LedgerEntryType !== 'Credential' || node.Subject !== ref.subject || node.Issuer !== ref.issuer || node.CredentialType !== ref.credentialType) continue
        return {
          ...ref, id: node.index, exists: true, accepted: (Number(node.Flags) & 0x00010000) !== 0,
          expiration: node.Expiration ?? null, expired: node.Expiration !== undefined && node.Expiration < ledger.result.ledger.close_time,
        }
      }
      marker = page.result.marker
    } while (marker !== undefined)
  }
  return { ...ref, id: null, exists: false, accepted: false, expiration: null, expired: false }
}
export async function issueCredential(ref: CredentialRef): Promise<TransactionResult> {
  return requireSuccess(await submitTransaction({ TransactionType: 'CredentialCreate', Account: ref.issuer, Subject: ref.subject, CredentialType: ref.credentialType }))
}
export async function acceptCredential(ref: CredentialRef): Promise<TransactionResult> {
  return requireSuccess(await submitTransaction({ TransactionType: 'CredentialAccept', Account: ref.subject, Issuer: ref.issuer, CredentialType: ref.credentialType }))
}
export async function revokeCredential(ref: CredentialRef): Promise<TransactionResult> {
  return requireSuccess(await submitTransaction({ TransactionType: 'CredentialDelete', Account: ref.issuer, Subject: ref.subject, CredentialType: ref.credentialType }))
}
