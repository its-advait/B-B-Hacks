import assert from 'node:assert/strict';
import test from 'node:test';
import type { AccountSnapshot, Actor, IntendedPolicy, PaymentObservation } from '../../shared/contracts.js';
import { deriveIntendedPolicy, expectedOutcome } from './evaluate.js';
import { authorizationFingerprint } from './fingerprint.js';
import { buildReport, classifyObservation } from './report.js';

const policy: IntendedPolicy = {
  trustedIssuer: 'rIssuer',
  credentialType: 'customer',
  requireCurrentAcceptedCredential: true,
  individualExceptions: [],
};

function actor(overrides: Partial<Actor> & Pick<Actor, 'role' | 'address' | 'credentialStatus'>): Actor {
  return { individuallyApproved: false, ...overrides };
}

function snapshot(overrides: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return {
    network: 'devnet',
    ledgerIndex: 100,
    treasuryAddress: 'rTreasury',
    issuerAddress: 'rIssuer',
    credentialType: 'customer',
    depositAuthEnabled: true,
    trustedCredentialRulePresent: true,
    capturedAt: '2026-01-01T00:00:00.000Z',
    actors: [
      actor({ role: 'validCustomer', address: 'rValid', credentialStatus: 'valid' }),
      actor({ role: 'legacyCustomer', address: 'rLegacy', credentialStatus: 'revoked', individuallyApproved: true }),
      actor({ role: 'stranger', address: 'rStranger', credentialStatus: 'none' }),
    ],
    ...overrides,
  };
}

function observation(
  role: PaymentObservation['actor'],
  observed: PaymentObservation['observed'],
  resultCode: string,
  extras: Partial<PaymentObservation> = {},
): PaymentObservation {
  return {
    actor: role,
    observed,
    validated: true,
    transactionHash: `HASH_${role}`,
    resultCode,
    ...extras,
  };
}

test('valid credential from the configured issuer is allowed, and a ledger approval is not', () => {
  const state = snapshot();
  const valid = state.actors[0];
  const legacy = state.actors[1];
  const stranger = state.actors[2];
  assert.ok(valid && legacy && stranger);
  assert.equal(expectedOutcome(valid, policy, state), 'allowed');
  assert.equal(expectedOutcome(legacy, policy, state), 'blocked');
  assert.equal(expectedOutcome(stranger, policy, state), 'blocked');
  assert.equal(legacy.individuallyApproved, true);
});

test('an explicit exception allows a revoked customer without treating ledger approval as policy', () => {
  const state = snapshot();
  const legacy = state.actors[1];
  assert.ok(legacy);
  const withException: IntendedPolicy = { ...policy, individualExceptions: [legacy.address] };
  assert.equal(expectedOutcome(legacy, withException, state), 'allowed');
  const accidental = actor({
    role: 'legacyCustomer',
    address: 'rOther',
    credentialStatus: 'revoked',
    individuallyApproved: true,
  });
  assert.equal(expectedOutcome(accidental, policy, state), 'blocked');
});

test('valid status does not satisfy a different configured issuer or type', () => {
  const state = snapshot();
  const valid = state.actors[0];
  assert.ok(valid);
  assert.equal(expectedOutcome(valid, { ...policy, trustedIssuer: 'rOtherIssuer' }, state), 'blocked');
  assert.equal(expectedOutcome(valid, { ...policy, credentialType: 'other' }, state), 'blocked');
});

test('demo policy copies issuer and type and never copies direct approvals', () => {
  const derived = deriveIntendedPolicy(snapshot());
  assert.deepEqual(derived, policy);
});

test('validated authorization denial stays blocked and other failures become inconclusive', () => {
  const denied = classifyObservation(observation('stranger', 'blocked', 'tecNO_PERMISSION'));
  assert.equal(denied.observed, 'blocked');

  const unfunded = classifyObservation(observation('stranger', 'blocked', 'tecUNFUNDED_PAYMENT'));
  assert.equal(unfunded.observed, 'inconclusive');

  const unvalidated = classifyObservation(
    observation('legacyCustomer', 'blocked', 'tecNO_PERMISSION', { validated: false }),
  );
  assert.equal(unvalidated.observed, 'inconclusive');

  const transport = classifyObservation({
    actor: 'validCustomer',
    observed: 'inconclusive',
    validated: false,
    error: 'timeout',
  });
  assert.equal(transport.observed, 'inconclusive');

  const falseSuccess = classifyObservation(observation('validCustomer', 'allowed', 'tecNO_PERMISSION'));
  assert.equal(falseSuccess.observed, 'inconclusive');
});

test('legacy direct approval produces one repair, and a non-authorization failure does not', () => {
  const state = snapshot();
  const report = buildReport({
    phase: 'before',
    snapshot: state,
    policy,
    observations: [
      observation('validCustomer', 'allowed', 'tesSUCCESS'),
      observation('legacyCustomer', 'allowed', 'tesSUCCESS'),
      observation('stranger', 'blocked', 'tecNO_PERMISSION'),
    ],
    completedAt: '2026-01-01T00:01:00.000Z',
    planId: 'plan-1',
  });

  assert.equal(report.rows[0]?.verdict, 'match');
  assert.equal(report.rows[1]?.verdict, 'mismatch');
  assert.equal(report.rows[1]?.expected, 'blocked');
  assert.equal(report.rows[1]?.observed, 'allowed');
  assert.equal(report.rows[2]?.verdict, 'match');
  assert.equal(report.repairPlan?.id, 'plan-1');
  assert.equal(report.repairPlan?.affectedAddress, 'rLegacy');
  assert.deepEqual(report.repairPlan?.unsignedTransaction, {
    TransactionType: 'DepositPreauth',
    Account: 'rTreasury',
    Unauthorize: 'rLegacy',
  });
  assert.match(report.repairPlan?.description ?? '', /Testnet configuration change/);
  assert.match(report.rows[1]?.explanation ?? '', /direct account preauthorization/);

  const inconclusive = buildReport({
    phase: 'before',
    snapshot: state,
    policy,
    observations: [
      observation('validCustomer', 'allowed', 'tesSUCCESS'),
      observation('legacyCustomer', 'blocked', 'tecUNFUNDED_PAYMENT'),
      observation('stranger', 'blocked', 'tecNO_PERMISSION'),
    ],
  });
  assert.equal(inconclusive.rows[1]?.verdict, 'inconclusive');
  assert.equal(inconclusive.rows[1]?.observed, 'inconclusive');
  assert.equal(inconclusive.repairPlan, undefined);
});

test('an intended exception does not generate a repair for the same direct approval', () => {
  const state = snapshot();
  const report = buildReport({
    phase: 'before',
    snapshot: state,
    policy: { ...policy, individualExceptions: ['rLegacy'] },
    observations: [
      observation('validCustomer', 'allowed', 'tesSUCCESS'),
      observation('legacyCustomer', 'allowed', 'tesSUCCESS'),
      observation('stranger', 'blocked', 'tecNO_PERMISSION'),
    ],
  });
  assert.equal(report.rows[1]?.verdict, 'match');
  assert.equal(report.rows[1]?.expected, 'allowed');
  assert.equal(report.repairPlan, undefined);
});

test('success without a direct approval or with Deposit Authorization off does not invent a repair', () => {
  const noApproval = snapshot({
    actors: [
      actor({ role: 'validCustomer', address: 'rValid', credentialStatus: 'valid' }),
      actor({ role: 'legacyCustomer', address: 'rLegacy', credentialStatus: 'revoked' }),
      actor({ role: 'stranger', address: 'rStranger', credentialStatus: 'none' }),
    ],
  });
  const unexplained = buildReport({
    phase: 'before',
    snapshot: noApproval,
    policy,
    observations: [
      observation('validCustomer', 'allowed', 'tesSUCCESS'),
      observation('legacyCustomer', 'allowed', 'tesSUCCESS'),
      observation('stranger', 'blocked', 'tecNO_PERMISSION'),
    ],
  });
  assert.equal(unexplained.rows[1]?.verdict, 'mismatch');
  assert.equal(unexplained.repairPlan, undefined);
  assert.match(unexplained.rows[1]?.explanation ?? '', /no single-approval repair/);

  const authOff = buildReport({
    phase: 'before',
    snapshot: snapshot({ depositAuthEnabled: false }),
    policy,
    observations: [
      observation('validCustomer', 'allowed', 'tesSUCCESS'),
      observation('legacyCustomer', 'allowed', 'tesSUCCESS'),
      observation('stranger', 'allowed', 'tesSUCCESS'),
    ],
  });
  assert.equal(authOff.repairPlan, undefined);
  assert.match(authOff.rows[1]?.explanation ?? '', /Deposit Authorization is not enabled/);
});

test('fingerprint ignores ledger movement and changes when authorization or policy changes', () => {
  const state = snapshot();
  const original = authorizationFingerprint(state, policy);
  assert.equal(authorizationFingerprint(snapshot({ ledgerIndex: 999, capturedAt: '2026-02-02T00:00:00.000Z' }), policy), original);

  const reordered = snapshot({
    actors: [...state.actors].reverse(),
  });
  assert.equal(authorizationFingerprint(reordered, policy), original);
  assert.equal(
    authorizationFingerprint(state, { ...policy, individualExceptions: ['rB', 'rA'] }),
    authorizationFingerprint(state, { ...policy, individualExceptions: ['rA', 'rB'] }),
  );

  const revokedBecomesValid = snapshot({
    actors: state.actors.map((item) =>
      item.role === 'legacyCustomer' ? { ...item, credentialStatus: 'valid' as const } : item,
    ),
  });
  assert.notEqual(authorizationFingerprint(revokedBecomesValid, policy), original);

  const approvalRemoved = snapshot({
    actors: state.actors.map((item) =>
      item.role === 'legacyCustomer' ? { ...item, individuallyApproved: false } : item,
    ),
  });
  assert.notEqual(authorizationFingerprint(approvalRemoved, policy), original);
  assert.notEqual(authorizationFingerprint(state, { ...policy, individualExceptions: ['rLegacy'] }), original);
  assert.notEqual(authorizationFingerprint(snapshot({ depositAuthEnabled: false }), policy), original);
});
