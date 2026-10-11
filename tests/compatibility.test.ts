import test from 'node:test'
import assert from 'node:assert/strict'
import { ACTOR_MAPPING, credentialStatus, paymentObservation, readSnapshot, removeIndividualApproval } from '../src/server/ledger/compatibility.js'
import type { CredentialState, TransactionResult } from '../src/server/ledger/types.js'
const credential: CredentialState = { subject: 'actor', issuer: 'issuer', credentialType: 'AB', exists: true, id: 'id', accepted: true, expiration: null, expired: false }
const receipt: TransactionResult = { transactionHash: 'actual-hash', validated: true, resultCode: 'tesSUCCESS', successful: true, ledgerIndex: 1, sender: 'actor', sequence: 1, lastLedgerSequence: 10 }
test('role mapping matches the shared contracts', () => {
  assert.deepEqual(ACTOR_MAPPING, { validCustomer: 'alice', legacyCustomer: 'bob', stranger: 'charlie' })
})
test('valid guarantees acceptance, expiry, subject, issuer and type', () => {
  assert.equal(credentialStatus(credential, 'actor', 'issuer', 'AB', false), 'valid')
  for (const change of [{ accepted: false }, { expired: true }, { id: null }, { subject: 'other' }, { issuer: 'wrong' }, { credentialType: 'CD' }]) {
    assert.throws(() => credentialStatus({ ...credential, ...change }, 'actor', 'issuer', 'AB', false))
  }
})
test('missing is not revoked without actual setup revocation evidence', () => {
  assert.equal(credentialStatus({ ...credential, exists: false, id: null }, 'actor', 'issuer', 'AB', false), 'none')
  assert.equal(credentialStatus({ ...credential, exists: false, id: null }, 'actor', 'issuer', 'AB', true), 'revoked')
})
test('only validated authorization codes classify allowed/blocked; retain actual hash/code', () => {
  assert.equal(paymentObservation('legacyCustomer', receipt).observed, 'allowed')
  assert.equal(paymentObservation('legacyCustomer', { ...receipt, resultCode: 'tecNO_PERMISSION', successful: false }).observed, 'blocked')
  for (const item of [{ ...receipt, validated: false }, { ...receipt, resultCode: 'tecUNFUNDED_PAYMENT' }]) {
    const result = paymentObservation('stranger', item)
    assert.equal(result.observed, 'inconclusive')
    assert.equal(result.transactionHash, item.transactionHash)
    assert.equal(result.resultCode, item.resultCode)
  }
})
test('opaque session must be created by the ledger; serialized/forged sessions cannot read or repair', async () => {
  await assert.rejects(readSnapshot({ kind: 'gatecheck-private-session' }), /Unknown ledger session/)
  await assert.rejects(removeIndividualApproval({}, 'bob'), /Unknown ledger session/)
})
