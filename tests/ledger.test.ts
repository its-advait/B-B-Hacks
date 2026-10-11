import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyOutcome } from '../src/server/ledger/transactions.js'
import { permissionFingerprint } from '../src/server/ledger/permissions.js'
import { validateRepairApproval } from '../src/server/ledger/repair.js'
import type { Permissions, RepairPlan } from '../src/server/ledger/types.js'

const state: Permissions = {
  account: 'company', ledgerIndex: 1, ledgerHash: 'ledger', flags: 0x01000000, depositAuth: true,
  balanceDrops: '100000000', baseReserveDrops: '1000000',
  directApprovals: [{ account: 'bob', ledgerEntryId: 'approval' }], credentialApprovals: [], credentials: [], fingerprint: 'fingerprint', limitations: [],
}
const plan: RepairPlan = {
  id: 'plan', createdAt: new Date(0).toISOString(), expiresAt: new Date(10_000).toISOString(), networkUrl: 'devnet', company: 'company', target: 'bob', stateFingerprint: 'fingerprint',
  transaction: { TransactionType: 'DepositPreauth', Account: 'company', Unauthorize: 'bob' }, summary: 'remove Bob only',
}
test('only validated tesSUCCESS is allowed', () => {
  assert.deepEqual(classifyOutcome(true, { TransactionResult: 'tesSUCCESS' }), { resultCode: 'tesSUCCESS', successful: true })
  assert.deepEqual(classifyOutcome(true, { TransactionResult: 'tecNO_PERMISSION' }), { resultCode: 'tecNO_PERMISSION', successful: false })
})
test('timeouts, provisional success and missing metadata are inconclusive', () => {
  for (const [valid, meta] of [[false, { TransactionResult: 'tesSUCCESS' }], [false, { TransactionResult: 'tecNO_PERMISSION' }], [true, null], [true, 'unparsed']] as const) {
    assert.deepEqual(classifyOutcome(valid, meta), { resultCode: 'INCONCLUSIVE', successful: null })
  }
})
test('approval accepts the exact current plan', () => {
  assert.doesNotThrow(() => validateRepairApproval(plan, { approved: true, planId: 'plan', approvedBy: 'operator' }, state, 1))
})
test('repair rejects missing identity, wrong plan, stale state, expired preview, missing approval, and altered transaction', () => {
  assert.throws(() => validateRepairApproval(plan, { approved: true, planId: 'different', approvedBy: 'operator' }, state, 1), /approval/)
  assert.throws(() => validateRepairApproval(plan, { approved: true, planId: 'plan', approvedBy: '' }, state, 1), /approval/)
  assert.throws(() => validateRepairApproval(plan, { approved: true, planId: 'plan', approvedBy: 'operator' }, { ...state, fingerprint: 'changed' }, 1), /state changed/)
  assert.throws(() => validateRepairApproval(plan, { approved: true, planId: 'plan', approvedBy: 'operator' }, state, 10_000), /expired/)
  assert.throws(() => validateRepairApproval(plan, { approved: true, planId: 'plan', approvedBy: 'operator' }, { ...state, directApprovals: [] }, 1), /no longer exists/)
  assert.throws(() => validateRepairApproval({ ...plan, transaction: { TransactionType: 'DepositPreauth', Account: 'company', Unauthorize: 'alice' } }, { approved: true, planId: 'plan', approvedBy: 'operator' }, state, 1), /does not match/)
})
test('permission fingerprint is order-independent and ignores unrelated balances and ledgers', () => {
  const a = { ...state, directApprovals: [{ account: 'alice', ledgerEntryId: 'a' }, { account: 'bob', ledgerEntryId: 'b' }] }
  const unrelatedChange = { ...a, directApprovals: [...a.directApprovals].reverse(), balanceDrops: '5', ledgerIndex: 99 }
  assert.equal(permissionFingerprint(a), permissionFingerprint(unrelatedChange))
  assert.notEqual(permissionFingerprint(a), permissionFingerprint({ ...a, directApprovals: [] }))
})
test('credential revocation changes the permission fingerprint', () => {
  const credentials = [{ subject: 'alice', issuer: 'issuer', credentialType: '01', id: 'id', exists: true, accepted: true, expiration: null, expired: false }]
  assert.notEqual(permissionFingerprint({ ...state, credentials }), permissionFingerprint({ ...state, credentials: [] }))
})
