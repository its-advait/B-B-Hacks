import { createHash } from 'node:crypto';
import type { AccountSnapshot, IntendedPolicy, RepairPlan } from '../../shared/contracts.js';

/**
 * Stable authorization fingerprint.
 * Includes DepositAuth, direct preauthorizations, trusted issuer/type,
 * credential validity, and the intended policy fields that change an outcome.
 * Excludes ledger index, snapshot time, balances, sequence, and fees.
 */
export function authorizationFingerprint(snapshot: AccountSnapshot, policy: IntendedPolicy): string {
  const actors = [...snapshot.actors].sort((left, right) => {
    const byAddress = left.address.localeCompare(right.address);
    return byAddress === 0 ? left.role.localeCompare(right.role) : byAddress;
  });

  const payload = {
    credentialType: snapshot.credentialType,
    credentials: actors.map((actor) => ({
      address: actor.address,
      credentialStatus: actor.credentialStatus,
      role: actor.role,
    })),
    depositAuthEnabled: snapshot.depositAuthEnabled,
    individualExceptions: [...policy.individualExceptions].sort(),
    issuerAddress: snapshot.issuerAddress,
    network: snapshot.network,
    policyCredentialType: policy.credentialType,
    preauthorizations: actors.map((actor) => ({
      address: actor.address,
      individuallyApproved: actor.individuallyApproved,
    })),
    requireCurrentAcceptedCredential: policy.requireCurrentAcceptedCredential,
    trustedCredentialRulePresent: snapshot.trustedCredentialRulePresent,
    trustedIssuer: policy.trustedIssuer,
  };

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function repairStaleReason(
  plan: RepairPlan,
  snapshot: AccountSnapshot,
  policy: IntendedPolicy,
): string | undefined {
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
