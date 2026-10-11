import type { DepositPreauth } from 'xrpl'

export type Role = 'company' | 'alice' | 'bob' | 'charlie' | 'issuer'
export type Accounts = Record<Role, string>
export interface NetworkProof {
  url: string
  network: 'devnet' | 'testnet'
  networkId: number
  ledgerIndex: number
  ledgerHash: string
  amendments: Record<string, boolean>
}
export interface TransactionResult {
  transactionHash: string
  validated: boolean
  resultCode: string
  successful: boolean | null
  ledgerIndex: number | null
  sender: string
  sequence: number
  lastLedgerSequence: number
  error?: string
}
export interface CredentialRef { subject: string; issuer: string; credentialType: string }
export interface CredentialState extends CredentialRef {
  id: string | null
  exists: boolean
  accepted: boolean
  expiration: number | null
  expired: boolean
}
export interface CredentialRule { issuer: string; credentialType: string }
export interface Permissions {
  account: string
  ledgerIndex: number
  ledgerHash: string
  flags: number
  depositAuth: boolean
  balanceDrops: string
  baseReserveDrops: string
  directApprovals: Array<{ account: string; ledgerEntryId: string }>
  credentialApprovals: Array<{ credentials: CredentialRule[]; ledgerEntryId: string }>
  credentials: CredentialState[]
  fingerprint: string
  limitations: string[]
}
export interface RepairPlan {
  id: string
  createdAt: string
  expiresAt: string
  networkUrl: string
  company: string
  target: string
  stateFingerprint: string
  transaction: DepositPreauth
  summary: string
}
export interface RepairApproval { approved: true; planId: string; approvedBy: string }
export interface RepairResult {
  receipt: TransactionResult
  permissions: Permissions | null
}
export interface PaymentCase {
  customer: 'alice' | 'bob' | 'charlie'
  expectedAllowed: boolean
  credentialIds: string[]
  receipt: TransactionResult
  matchesPolicy: boolean | null
}
export interface TestPolicy {
  trustedIssuer: string
  credentialType: string
  directExceptions: string[]
}
