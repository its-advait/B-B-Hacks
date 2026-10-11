import assert from 'node:assert/strict';
import test from 'node:test';
import { createALedgerPort, type ALedgerModule, type DemoSession } from './aLedger.js';
import { credentialStatusFromRead, projectPayment, projectStoredRepair, type LedgerReceipt } from './ledgerMap.js';

const accounts = {
  company: 'rCompany',
  alice: 'rAlice',
  bob: 'rBob',
  charlie: 'rCharlie',
  issuer: 'rIssuer',
};

function receipt(overrides: Partial<LedgerReceipt> = {}): LedgerReceipt {
  return {
    transactionHash: 'HASH',
    validated: true,
    resultCode: 'tesSUCCESS',
    successful: true,
    ledgerIndex: 80,
    sender: 'rAlice',
    sequence: 4,
    lastLedgerSequence: 90,
    ...overrides,
  };
}

test('credential status is valid only for a current accepted id, and a missing credential is not revoked', () => {
  const current = {
    subject: 'rAlice',
    issuer: 'rIssuer',
    credentialType: 'HEX',
    id: 'CRED',
    exists: true,
    accepted: true,
    expired: false,
  };
  assert.equal(credentialStatusFromRead(current, new Set()), 'valid');
  assert.equal(credentialStatusFromRead({ ...current, id: null }, new Set()), 'none');
  assert.equal(credentialStatusFromRead({ ...current, exists: false, accepted: false, id: null }, new Set()), 'none');
  assert.equal(
    credentialStatusFromRead({ ...current, exists: false, accepted: false, id: null }, new Set(['rAlice'])),
    'revoked',
  );
  assert.equal(credentialStatusFromRead({ ...current, expired: true }, new Set()), 'none');
});

test('payment projection preserves the hash and keeps unknown outcomes inconclusive', () => {
  const unknown = projectPayment('legacyCustomer', receipt({
    transactionHash: 'KNOWN_HASH',
    validated: false,
    resultCode: 'INCONCLUSIVE',
    successful: null,
    ledgerIndex: 81,
    sender: 'rBob',
    sequence: 9,
    lastLedgerSequence: 99,
  }));
  assert.equal(unknown.observed, 'inconclusive');
  assert.equal(unknown.transactionHash, 'KNOWN_HASH');
  assert.equal(unknown.resultCode, 'INCONCLUSIVE');
  assert.equal('sequence' in unknown, false);
  assert.equal('ledgerIndex' in unknown, false);

  assert.equal(projectPayment('validCustomer', receipt()).observed, 'allowed');
  assert.equal(
    projectPayment('stranger', receipt({ resultCode: 'tecNO_PERMISSION', successful: false, sender: 'rCharlie' })).observed,
    'blocked',
  );
  assert.equal(
    projectPayment('stranger', receipt({ resultCode: 'tecUNFUNDED_PAYMENT', successful: false })).observed,
    'inconclusive',
  );
});

test('stored repair projection copies the preview and rejects a different transaction', () => {
  const plan = projectStoredRepair({
    id: 'plan-a',
    summary: 'Remove only this direct wallet approval.',
    target: 'rBob',
    stateFingerprint: 'fp-a',
    transaction: { TransactionType: 'DepositPreauth', Account: 'rCompany', Unauthorize: 'rBob' },
  });
  assert.equal(plan.id, 'plan-a');
  assert.equal(plan.snapshotFingerprint, 'fp-a');
  assert.equal(plan.unsignedTransaction.Unauthorize, 'rBob');
  assert.throws(() =>
    projectStoredRepair({
      id: 'plan-b',
      summary: 'wrong',
      target: 'rBob',
      stateFingerprint: 'fp',
      transaction: { TransactionType: 'Payment', Account: 'rCompany' },
    }),
  );
});

test('adapter reads credentials explicitly, omits legacy and stranger ids, and uses A repair approval', async () => {
  const payments: Array<{ sender: string; company: string; credentialIds: string[] | undefined }> = [];
  const reads: string[] = [];
  let approval: { approved: true; planId: string; approvedBy: string } | null = null;
  const credentials: Record<string, { exists: boolean; accepted: boolean; expired: boolean; id: string | null; fail?: boolean }> = {
    rAlice: { exists: true, accepted: true, expired: false, id: 'ALICE_ID' },
    rBob: { exists: false, accepted: false, expired: false, id: null },
    rCharlie: { exists: false, accepted: false, expired: false, id: null },
  };

  const mod: ALedgerModule = {
    CUSTOMER_TYPE: 'HEXTYPE',
    async connectLedger() {
      return { network: 'devnet' };
    },
    async createTestAccounts() {
      return accounts;
    },
    async setupPermissions() {
      return { receipts: [] };
    },
    async readPermissions() {
      return {
        account: accounts.company,
        ledgerIndex: 70,
        depositAuth: true,
        directApprovals: [{ account: accounts.bob }],
        credentialApprovals: [{ credentials: [{ issuer: accounts.issuer, credentialType: 'HEXTYPE' }] }],
        fingerprint: 'perm-fp',
      };
    },
    async readCredential(ref) {
      reads.push(ref.subject);
      const state = credentials[ref.subject];
      if (!state || state.fail) {
        throw new Error('RPC timeout');
      }
      return { ...ref, ...state, expiration: null };
    },
    async testPayment(sender, company, credentialIds) {
      payments.push({ sender, company, credentialIds });
      const resultCode = sender === accounts.charlie ? 'tecNO_PERMISSION' : 'tesSUCCESS';
      const successful = resultCode === 'tesSUCCESS';
      return receipt({
        transactionHash: `PAY_${sender}`,
        resultCode,
        successful,
        sender,
        sequence: sender === accounts.bob ? 11 : 3,
        lastLedgerSequence: 100,
      });
    },
    async previewRemoveDirectApproval(company, target, refs) {
      assert.equal(company, accounts.company);
      assert.equal(target, accounts.bob);
      assert.equal(refs?.length, 3);
      return {
        id: 'preview-1',
        summary: 'Remove only this direct wallet approval.',
        company,
        target,
        stateFingerprint: 'perm-fp',
        transaction: { TransactionType: 'DepositPreauth', Account: company, Unauthorize: target },
      };
    },
    async removeDirectApproval(planId, next) {
      approval = next;
      assert.equal(planId, 'preview-1');
      return { receipt: receipt({ transactionHash: 'REPAIR', sender: accounts.company, sequence: 12 }) };
    },
    customerRefs(next) {
      return [next.alice, next.bob, next.charlie].map((subject) => ({
        subject,
        issuer: next.issuer,
        credentialType: 'HEXTYPE',
      }));
    },
  };

  const port = createALedgerPort(mod);
  const session = (await port.createDemoEnvironment(() => undefined)) as DemoSession;
  const snapshot = await port.readSnapshot(session);
  assert.equal(snapshot.network, 'devnet');
  assert.equal(snapshot.credentialType, 'HEXTYPE');
  assert.equal(snapshot.actors.find((actor) => actor.role === 'validCustomer')?.credentialStatus, 'valid');
  assert.equal(snapshot.actors.find((actor) => actor.role === 'legacyCustomer')?.credentialStatus, 'revoked');
  assert.equal(snapshot.actors.find((actor) => actor.role === 'stranger')?.credentialStatus, 'none');
  assert.equal(snapshot.actors.find((actor) => actor.role === 'legacyCustomer')?.individuallyApproved, true);
  assert.equal(snapshot.trustedCredentialRulePresent, true);

  credentials.rBob = { exists: true, accepted: true, expired: false, id: 'BOB_DELETED_ID' };
  const alice = await port.sendTestPayment(session, 'validCustomer');
  const bob = await port.sendTestPayment(session, 'legacyCustomer');
  credentials.rCharlie = { exists: false, accepted: false, expired: false, id: null, fail: true };
  const charlie = await port.sendTestPayment(session, 'stranger');

  assert.deepEqual(payments.map((payment) => payment.credentialIds), [['ALICE_ID'], []]);
  assert.equal(payments.some((payment) => payment.sender === accounts.charlie), false);
  assert.equal(alice.observed, 'allowed');
  assert.equal(bob.observed, 'allowed');
  assert.equal(bob.transactionHash, 'PAY_rBob');
  assert.equal(charlie.observed, 'inconclusive');
  assert.match(charlie.error ?? '', /inconclusive/);
  assert.equal(session.evidence[1]?.sequence, 11);
  assert.equal(JSON.stringify(bob).includes('"sequence"'), false);

  const plan = await port.previewDirectApprovalRepair(session, accounts.bob);
  assert.equal(plan.id, 'preview-1');
  assert.equal(plan.snapshotFingerprint, 'perm-fp');
  const executed = await port.executeStoredRepair(session, plan.id);
  assert.equal(executed.transactionHash, 'REPAIR');
  assert.deepEqual(approval, { approved: true, planId: 'preview-1', approvedBy: 'gatecheck-operator' });
  assert.equal(reads.includes(accounts.bob), true);
});
