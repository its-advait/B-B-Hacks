import { xrpToDrops } from 'xrpl'
import { CUSTOMER_TYPE, readCredential } from './credentials.js'
import { readPermissions } from './permissions.js'
import { submitTransaction } from './transactions.js'
import type { Accounts, PaymentCase, TransactionResult, TestPolicy } from './types.js'

export async function testPayment(sender: string, companyAddress: string, credentialIds: string[] = []): Promise<TransactionResult> {
  return submitTransaction({
    TransactionType: 'Payment', Account: sender, Destination: companyAddress, Amount: xrpToDrops('1'),
    ...(credentialIds.length ? { CredentialIDs: credentialIds } : {}),
  })
}
export async function runPaymentSuite(accounts: Accounts, policy: TestPolicy = { trustedIssuer: accounts.issuer, credentialType: CUSTOMER_TYPE, directExceptions: [] }): Promise<PaymentCase[]> {
  const permission = await readPermissions(accounts.company)
  if (!permission.depositAuth || BigInt(permission.balanceDrops) <= BigInt(permission.baseReserveDrops) + 10_000_000n) {
    throw new Error('Suite requires DepositAuth and receiver safely above reserve')
  }
  const cases: PaymentCase[] = []
  for (const customer of ['alice', 'bob', 'charlie'] as const) {
    const credential = await readCredential({ subject: accounts[customer], issuer: policy.trustedIssuer, credentialType: policy.credentialType })
    const credentialIds = credential.exists && credential.accepted && !credential.expired && credential.id ? [credential.id] : []
    const expectedAllowed = policy.directExceptions.includes(accounts[customer]) || credentialIds.length > 0
    const receipt = await testPayment(accounts[customer], accounts.company, credentialIds)
    cases.push({ customer, expectedAllowed, credentialIds, receipt, matchesPolicy: receipt.validated && (receipt.resultCode === 'tesSUCCESS' || receipt.resultCode === 'tecNO_PERMISSION') ? expectedAllowed === receipt.successful : null })
  }
  return cases
}
