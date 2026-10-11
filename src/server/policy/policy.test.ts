import assert from 'node:assert/strict';
import test from 'node:test';
import type { AccountSnapshot, Actor, IntendedPolicy, PaymentObservation } from '../../shared/contracts.js';
import { deriveIntendedPolicy, evaluateIntended, expectedOutcome, PolicyInputError } from './evaluate.js';
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
  assert.match(report.repairPlan?.description ?? '', /^Devnet configuration change:/);
  const altnet = buildReport({
    phase: 'before',
    snapshot: snapshot({ network: 'testnet' }),
    policy,
    observations: [
      observation('validCustomer', 'allowed', 'tesSUCCESS'),
      observation('legacyCustomer', 'allowed', 'tesSUCCESS'),
      observation('stranger', 'blocked', 'tecNO_PERMISSION'),
    ],
  });
  assert.match(altnet.repairPlan?.description ?? '', /^Testnet configuration change:/);
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
  assert.notEqual(authorizationFingerprint(snapshot({ trustedCredentialRulePresent: false }), policy), original);
  assert.notEqual(authorizationFingerprint(snapshot({ treasuryAddress: 'rOtherTreasury' }), policy), original);
  assert.equal(
    authorizationFingerprint(snapshot({ credentialType: 'abcd' }), { ...policy, credentialType: 'ABCD' }),
    authorizationFingerprint(snapshot({ credentialType: 'ABCD' }), { ...policy, credentialType: 'abcd' }),
  );
});

test('intended decisions follow credential status, exceptions, and issuer/type only', () => {
  const state = snapshot();
  const valid = state.actors[0];
  const legacy = state.actors[1];
  const stranger = state.actors[2];
  assert.ok(valid && legacy && stranger);

  const allowed = evaluateIntended(valid, policy, state);
  assert.equal(allowed.expected, 'allowed');
  assert.match(allowed.reason, /valid/);

  const revokedApproved = evaluateIntended({ ...legacy, individuallyApproved: true }, policy, state);
  const revokedNotApproved = evaluateIntended({ ...legacy, individuallyApproved: false }, policy, state);
  assert.equal(revokedApproved.expected, 'blocked');
  assert.deepEqual(revokedApproved, revokedNotApproved);

  assert.equal(evaluateIntended(stranger, policy, state).expected, 'blocked');
  assert.match(evaluateIntended(stranger, policy, state).reason, /No credential/);

  const excepted = evaluateIntended(legacy, { ...policy, individualExceptions: [legacy.address] }, state);
  assert.equal(excepted.expected, 'allowed');
  assert.match(excepted.reason, /explicit intended exception/);
  assert.equal(evaluateIntended(legacy, { ...policy, individualExceptions: [legacy.address.toLowerCase()] }, state).expected, 'blocked');

  const depositOff = snapshot({ depositAuthEnabled: false, trustedCredentialRulePresent: false });
  assert.deepEqual(evaluateIntended(valid, policy, depositOff), evaluateIntended(valid, policy, state));
  assert.deepEqual(evaluateIntended(legacy, policy, depositOff), evaluateIntended(legacy, policy, state));

  const wrongIssuer = evaluateIntended(valid, policy, snapshot({ issuerAddress: 'rOtherIssuer' }));
  assert.equal(wrongIssuer.expected, 'blocked');
  assert.match(wrongIssuer.reason, /does not match intended policy/);
  assert.equal(evaluateIntended(valid, { ...policy, credentialType: 'Customer' }, state).expected, 'blocked');

  const hexSnapshot = snapshot({ credentialType: 'ab' });
  assert.equal(evaluateIntended(valid, { ...policy, credentialType: 'AB' }, hexSnapshot).expected, 'allowed');
});

test('malformed policy input is rejected and evaluation does not mutate its input', () => {
  const state = snapshot();
  const valid = state.actors[0];
  assert.ok(valid);
  const beforeState = structuredClone(state);
  const beforePolicy = structuredClone(policy);
  evaluateIntended(valid, policy, state);
  assert.deepEqual(state, beforeState);
  assert.deepEqual(policy, beforePolicy);

  assert.throws(() => evaluateIntended({ ...valid, credentialStatus: 'expired' as 'valid' }, policy, state), PolicyInputError);
  assert.throws(() => evaluateIntended(valid, { ...policy, requireCurrentAcceptedCredential: false as true }, state), PolicyInputError);
  assert.throws(() => evaluateIntended(valid, policy, snapshot({ issuerAddress: '' })), PolicyInputError);
});

test('missing evidence stays inconclusive and a report freezes its inputs', () => {
  const state = snapshot();
  const observations = [
    observation('validCustomer', 'allowed', 'tesSUCCESS'),
    observation('legacyCustomer', 'allowed', 'tesSUCCESS', { transactionHash: undefined }),
    observation('stranger', 'blocked', 'tecNO_PERMISSION'),
  ];
  const missing = classifyObservation(observations[1]!);
  assert.equal(missing.observed, 'inconclusive');

  const report = buildReport({
    phase: 'before',
    snapshot: state,
    policy,
    observations,
    completedAt: '2026-01-01T00:02:00.000Z',
    planId: 'plan-frozen',
  });
  state.actors[1]!.individuallyApproved = false;
  state.ledgerIndex = 5;
  observations[1]!.resultCode = 'tecUNFUNDED_PAYMENT';
  assert.equal(report.snapshot.actors[1]?.individuallyApproved, true);
  assert.equal(report.snapshot.ledgerIndex, 100);
  assert.equal(report.rows[1]?.verdict, 'inconclusive');
  assert.equal(report.rows[1]?.resultCode, 'tesSUCCESS');
  assert.equal(report.repairPlan, undefined);

  assert.throws(() => buildReport({
    phase: 'before',
    snapshot: snapshot({ actors: state.actors.slice(0, 2) }),
    policy,
    observations,
  }), PolicyInputError);
  assert.throws(() => buildReport({
    phase: 'before',
    snapshot: snapshot(),
    policy,
    observations: [observation('legacyCustomer', 'allowed', 'tesSUCCESS'), observation('legacyCustomer', 'blocked', 'tecNO_PERMISSION')],
  }), PolicyInputError);
});

test('one repair plan is stored when several direct approvals conflict', () => {
  const state = snapshot({
    actors: [
      actor({ role: 'validCustomer', address: 'rValid', credentialStatus: 'valid' }),
      actor({ role: 'legacyCustomer', address: 'rLegacy', credentialStatus: 'revoked', individuallyApproved: true }),
      actor({ role: 'stranger', address: 'rStranger', credentialStatus: 'none', individuallyApproved: true }),
    ],
  });
  const report = buildReport({
    phase: 'before',
    snapshot: state,
    policy,
    observations: [
      observation('validCustomer', 'allowed', 'tesSUCCESS'),
      observation('legacyCustomer', 'allowed', 'tesSUCCESS'),
      observation('stranger', 'allowed', 'tesSUCCESS'),
    ],
    planId: 'plan-one',
  });
  assert.equal(report.repairPlan?.affectedAddress, 'rLegacy');
  assert.match(report.repairPlan?.description ?? '', /one plan/);
  assert.match(report.rows[2]?.explanation ?? '', /only one repair plan/);
});
