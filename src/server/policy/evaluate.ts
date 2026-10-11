import type { AccountSnapshot, Actor, IntendedPolicy } from '../../shared/contracts.js';

/**
 * Expected outcome follows intended policy only.
 * A ledger direct approval (`individuallyApproved`) is not an exception.
 *
 * `credentialStatus === 'valid'` is treated as a current accepted credential
 * from `snapshot.issuerAddress` / `snapshot.credentialType`. That guarantee
 * belongs to the ledger adapter; this module does not invent per-actor issuer,
 * type, acceptance, or expiry fields.
 */
export function expectedOutcome(
  actor: Actor,
  policy: IntendedPolicy,
  snapshot: AccountSnapshot,
): 'allowed' | 'blocked' {
  if (policy.individualExceptions.includes(actor.address)) {
    return 'allowed';
  }

  const credentialMatchesConfiguredIssuer =
    policy.requireCurrentAcceptedCredential &&
    actor.credentialStatus === 'valid' &&
    snapshot.issuerAddress === policy.trustedIssuer &&
    snapshot.credentialType === policy.credentialType;

  return credentialMatchesConfiguredIssuer ? 'allowed' : 'blocked';
}

/** Demo policy: snapshot issuer and type, with no intended account exceptions. */
export function deriveIntendedPolicy(snapshot: AccountSnapshot): IntendedPolicy {
  return {
    trustedIssuer: snapshot.issuerAddress,
    credentialType: snapshot.credentialType,
    requireCurrentAcceptedCredential: true,
    individualExceptions: [],
  };
}
