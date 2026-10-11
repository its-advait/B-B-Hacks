import { createHash } from 'node:crypto';
import type { AccountSnapshot, IntendedPolicy, RepairPlan } from '../../shared/contracts.js';
import { canonicalCredentialType } from './evaluate.js';

/**
 * Canonical fingerprint of the shared snapshot's represented permission scope
 * plus the intended policy. It is not a hash of every ledger object.
 *
 * Included: network, treasury, issuer, credential type, DepositAuth,
 * trusted-credential-rule presence, each actor's address, credential status,
 * and direct approval, and the intended issuer, type, and exceptions.
 * Hex credential types are canonicalized; human-readable names are not.
 *
 * Excluded: ledgerIndex, capturedAt, balances, fees, transaction sequence,
 * and other incidental values. Advancing a ledger alone does not change it.
 */
export function authorizationFingerprint(snapshot: AccountSnapshot, policy: IntendedPolicy): string {
  const actors = [...snapshot.actors].sort((left, right) => {
    const byAddress = left.address.localeCompare(right.address);
    return byAddress === 0 ? left.role.localeCompare(right.role) : byAddress;
  });

  const payload = {
    actors: actors.map((actor) => ({
      address: actor.address,
      credentialStatus: actor.credentialStatus,
      individuallyApproved: actor.individuallyApproved,
      role: actor.role,
    })),
    credentialType: canonicalCredentialType(snapshot.credentialType),
    depositAuthEnabled: snapshot.depositAuthEnabled,
    individualExceptions: [...policy.individualExceptions].sort(),
    issuerAddress: snapshot.issuerAddress,
    network: snapshot.network,
    policyCredentialType: canonicalCredentialType(policy.credentialType),
    requireCurrentAcceptedCredential: policy.requireCurrentAcceptedCredential,
    treasuryAddress: snapshot.treasuryAddress,
    trustedCredentialRulePresent: snapshot.trustedCredentialRulePresent,
    trustedIssuer: policy.trustedIssuer,
  };

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** Policy-side check requested before calling A's approval function. */
export function repairStaleReason(plan: RepairPlan, snapshot: AccountSnapshot, policy: IntendedPolicy): string | undefined {
  if (plan.unsignedTransaction.TransactionType !== 'DepositPreauth') {
    return 'Stored repair is not a DepositPreauth transaction.';
  }
  if (plan.unsignedTransaction.Unauthorize !== plan.affectedAddress) {
    return 'Stored repair does not target the reviewed address.';
  }
  if (plan.unsignedTransaction.Account !== snapshot.treasuryAddress) {
    return 'Treasury address changed since this plan was created. Rerun checks.';
  }
  if (authorizationFingerprint(snapshot, policy) !== plan.snapshotFingerprint) {
    return 'Authorization-relevant state changed since this plan was created. Rerun checks.';
  }
  return undefined;
}
