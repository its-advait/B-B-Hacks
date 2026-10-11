import type { AccountSnapshot, Actor, IntendedPolicy } from '../../shared/contracts.js';

/**
 * Expected outcome follows intended policy only.
 * A ledger direct approval (`individuallyApproved`) is not an exception.
 * DepositAuth and the trusted-credential rule describe actual configuration
 * and are intentionally unread here.
 *
 * `credentialStatus === 'valid'` uses A's narrow adapter meaning: the credential
 * is accepted, unexpired, belongs to that actor, and was issued for the snapshot
 * issuer and credential type. This function does not re-read the ledger. It only
 * checks that the snapshot issuer and type still match the intended policy.
 */
export class PolicyInputError extends Error {
  readonly code = 'malformed_policy_input';

  constructor(message: string) {
    super(message);
    this.name = 'PolicyInputError';
  }
}

export interface IntendedDecision {
  expected: 'allowed' | 'blocked';
  reason: string;
}

const CREDENTIAL_STATUSES = new Set(['valid', 'revoked', 'none']);

/**
 * Even-length hex is compared in one canonical case so the decoded bytes stay
 * the same. Human-readable names are left untouched, including their case.
 */
export function canonicalCredentialType(value: string): string {
  if (/^[0-9A-Fa-f]+$/.test(value) && value.length % 2 === 0) {
    return value.toUpperCase();
  }
  return value;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PolicyInputError(`${label} is required.`);
  }
  return value;
}

function assertActor(actor: Actor): void {
  requireText(actor?.address, 'Actor address');
  if (!CREDENTIAL_STATUSES.has(actor.credentialStatus)) {
    throw new PolicyInputError('Actor credentialStatus must be valid, revoked, or none.');
  }
  if (typeof actor.individuallyApproved !== 'boolean') {
    throw new PolicyInputError('Actor individuallyApproved must be boolean ledger state.');
  }
}

function assertPolicy(policy: IntendedPolicy): void {
  requireText(policy?.trustedIssuer, 'Intended issuer');
  requireText(policy?.credentialType, 'Intended credential type');
  if (policy.requireCurrentAcceptedCredential !== true) {
    throw new PolicyInputError('Intended policy must require a current accepted credential.');
  }
  if (!Array.isArray(policy.individualExceptions) || policy.individualExceptions.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new PolicyInputError('Intended exceptions must be exact addresses.');
  }
}

function assertSnapshotIdentity(snapshot: AccountSnapshot): void {
  requireText(snapshot?.issuerAddress, 'Snapshot issuer');
  requireText(snapshot?.credentialType, 'Snapshot credential type');
}

/** Pure intended-policy decision. Does not read the ledger or mutate inputs. */
export function evaluateIntended(actor: Actor, policy: IntendedPolicy, snapshot: AccountSnapshot): IntendedDecision {
  assertActor(actor);
  assertPolicy(policy);
  assertSnapshotIdentity(snapshot);

  if (policy.individualExceptions.includes(actor.address)) {
    return { expected: 'allowed', reason: 'Address is an explicit intended exception.' };
  }

  const issuerMatches = snapshot.issuerAddress === policy.trustedIssuer;
  const typeMatches = canonicalCredentialType(snapshot.credentialType) === canonicalCredentialType(policy.credentialType);
  if (actor.credentialStatus === 'valid' && issuerMatches && typeMatches) {
    return {
      expected: 'allowed',
      reason: 'Credential status is valid and the snapshot issuer and credential type match intended policy.',
    };
  }
  if (actor.credentialStatus === 'valid') {
    return {
      expected: 'blocked',
      reason: 'Credential status is valid, but the snapshot issuer or credential type does not match intended policy.',
    };
  }
  if (actor.credentialStatus === 'revoked') {
    return { expected: 'blocked', reason: 'Credential is revoked and the address is not an intended exception.' };
  }
  return { expected: 'blocked', reason: 'No credential is present and the address is not an intended exception.' };
}

export function expectedOutcome(actor: Actor, policy: IntendedPolicy, snapshot: AccountSnapshot): 'allowed' | 'blocked' {
  return evaluateIntended(actor, policy, snapshot).expected;
}

/** Demo policy: snapshot issuer and type, with no intended account exceptions. */
export function deriveIntendedPolicy(snapshot: AccountSnapshot): IntendedPolicy {
  assertSnapshotIdentity(snapshot);
  return {
    trustedIssuer: snapshot.issuerAddress,
    credentialType: snapshot.credentialType,
    requireCurrentAcceptedCredential: true,
    individualExceptions: [],
  };
}
