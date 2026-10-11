import { randomUUID } from 'node:crypto';
import type {
  AccountSnapshot,
  Actor,
  ActorRole,
  CheckRow,
  IntendedPolicy,
  Outcome,
  PaymentObservation,
  Phase,
  RepairPlan,
  Report,
} from '../../shared/contracts.js';
import { expectedOutcome } from './evaluate.js';
import { authorizationFingerprint } from './fingerprint.js';

export const CHECK_ACTORS: readonly ActorRole[] = ['validCustomer', 'legacyCustomer', 'stranger'];

/** DepositAuth's validated rejection. Other codes are not permission evidence. */
const AUTHORIZATION_DENIAL = 'tecNO_PERMISSION';

export function classifyObservation(observation: PaymentObservation): PaymentObservation {
  if (observation.observed === 'inconclusive' || observation.validated !== true) {
    return { ...observation, observed: 'inconclusive' };
  }

  if (observation.observed === 'allowed') {
    if (observation.resultCode === 'tesSUCCESS') {
      return observation;
    }
    return {
      ...observation,
      observed: 'inconclusive',
      error:
        observation.error ??
        `Validated result ${observation.resultCode ?? 'unknown'} is not tesSUCCESS, so the payment is not an authorization success.`,
    };
  }

  if (observation.resultCode === AUTHORIZATION_DENIAL) {
    return observation;
  }

  return {
    ...observation,
    observed: 'inconclusive',
    error:
      observation.error ??
      `Result ${observation.resultCode ?? 'unknown'} is not a validated authorization rejection (${AUTHORIZATION_DENIAL}).`,
  };
}

function verdictFor(expected: 'allowed' | 'blocked', observed: Outcome): CheckRow['verdict'] {
  if (observed === 'inconclusive') {
    return 'inconclusive';
  }
  return observed === expected ? 'match' : 'mismatch';
}

function explain(input: {
  actor: Actor | undefined;
  expected: 'allowed' | 'blocked';
  observed: Outcome;
  policy: IntendedPolicy;
  snapshot: AccountSnapshot;
  observation: PaymentObservation;
  repaired: boolean;
  repairDeferred: boolean;
}): string {
  const { actor, expected, observed, policy, snapshot, observation, repaired } = input;
  const address = actor?.address ?? observation.actor;
  const code = observation.resultCode ? ` Result code ${observation.resultCode}.` : '';
  const detail = observation.error ? ` ${observation.error}` : '';

  if (!actor) {
    return `The snapshot has no actor record for ${observation.actor}, so this observation cannot be compared with intended policy.${code}${detail}`;
  }

  if (observed === 'inconclusive') {
    return `The ${actor.role} check is inconclusive.${code}${detail} This is not evidence that the payment was blocked.`;
  }

  if (expected === 'allowed' && observed === 'allowed') {
    if (policy.individualExceptions.includes(actor.address)) {
      return `${address} matched intended policy because that address is an explicit exception. The validated ledger result allowed the payment.${code}`;
    }
    return `${address} matched intended policy. Credential status is valid for snapshot issuer ${snapshot.issuerAddress} and type ${snapshot.credentialType}, which is the configured issuer and type. The validated ledger result allowed the payment.${code}`;
  }

  if (expected === 'blocked' && observed === 'blocked') {
    return `${address} matched intended policy. Credential status is ${actor.credentialStatus} and the address is not an intended exception. The validated ledger result denied the payment.${code}`;
  }

  if (expected === 'blocked' && observed === 'allowed') {
    if (!snapshot.depositAuthEnabled) {
      const approvalNote = actor.individuallyApproved
        ? ' A direct account preauthorization is present, but removing it would not show that the rule is enforced while Deposit Authorization is off.'
        : '';
      return `Intended policy blocks ${address} (credential status ${actor.credentialStatus}), but the validated payment succeeded.${code} Deposit Authorization is not enabled.${approvalNote} No repair is proposed.`;
    }
    if (actor.individuallyApproved) {
      const repair = input.repairDeferred
        ? ' A ledger repair preview was not stored, so no transaction was submitted.'
        : repaired
          ? ' The repair removes only this direct approval.'
          : ' Another conflicting approval is repaired first; rerun checks for this one.';
      return `Intended policy blocks ${address} (credential status ${actor.credentialStatus}; not an intended exception), but the validated payment succeeded.${code} The snapshot shows a direct account preauthorization. That approval is ledger state, not an intended exception.${repair}`;
    }
    return `Intended policy blocks ${address} (credential status ${actor.credentialStatus}), but the validated payment succeeded.${code} The snapshot does not show a direct account preauthorization for this address, so no single-approval repair is proposed.`;
  }

  return `Intended policy allows ${address}, but the validated ledger result denied the payment.${code} This is missing authorization, not an extra direct approval, so no Unauthorize repair is proposed.`;
}

export function buildReport(input: {
  phase: Phase;
  snapshot: AccountSnapshot;
  policy: IntendedPolicy;
  observations: PaymentObservation[];
  completedAt?: string;
  planId?: string;
  includeRepair?: boolean;
}): Report {
  const snapshot = structuredClone(input.snapshot);
  const policy = structuredClone(input.policy);
  const classified = new Map<ActorRole, PaymentObservation>();
  for (const observation of input.observations) {
    classified.set(observation.actor, classifyObservation(observation));
  }

  const actorsByRole = new Map(snapshot.actors.map((actor) => [actor.role, actor]));
  const draft: Array<{ actor: Actor | undefined; observation: PaymentObservation; expected: 'allowed' | 'blocked' }> = [];

  for (const role of CHECK_ACTORS) {
    const actor = actorsByRole.get(role);
    const observation = classified.get(role) ?? {
      actor: role,
      observed: 'inconclusive' as const,
      validated: false,
      error: 'No payment observation was returned for this actor.',
    };
    const expected = actor ? expectedOutcome(actor, policy, snapshot) : 'blocked';
    draft.push({ actor, observation, expected });
  }

  const repairIndex = draft.findIndex(({ actor, observation, expected }) => {
    return (
      actor !== undefined &&
      expected === 'blocked' &&
      observation.observed === 'allowed' &&
      observation.validated === true &&
      actor.individuallyApproved &&
      snapshot.depositAuthEnabled &&
      !policy.individualExceptions.includes(actor.address)
    );
  });

  const rows: CheckRow[] = draft.map((item, index) => {
    const observed = item.observation.observed;
    const row: CheckRow = {
      actor: item.observation.actor,
      observed,
      validated: item.observation.validated,
      expected: item.expected,
      verdict: verdictFor(item.expected, observed),
      explanation: explain({
        actor: item.actor,
        expected: item.expected,
        observed,
        policy,
        snapshot,
        observation: item.observation,
        repaired: index === repairIndex && input.includeRepair !== false,
        repairDeferred: index === repairIndex && input.includeRepair === false,
      }),
    };
    if (item.observation.transactionHash) {
      row.transactionHash = item.observation.transactionHash;
    }
    if (item.observation.resultCode) {
      row.resultCode = item.observation.resultCode;
    }
    if (item.observation.error) {
      row.error = item.observation.error;
    }
    return row;
  });

  const report: Report = {
    id: randomUUID(),
    phase: input.phase,
    snapshot,
    policy,
    rows,
    completedAt: input.completedAt ?? new Date().toISOString(),
  };

  const repairTarget = input.includeRepair === false ? undefined : repairIndex >= 0 ? draft[repairIndex] : undefined;
  if (repairTarget?.actor) {
    const affectedAddress = repairTarget.actor.address;
    const plan: RepairPlan = {
      id: input.planId ?? randomUUID(),
      description: `Testnet configuration change: remove the direct DepositPreauth approval for ${affectedAddress}. Intended policy does not list this address as an exception. Credential rules and every other approval stay in place.`,
      affectedAddress,
      unsignedTransaction: {
        TransactionType: 'DepositPreauth',
        Account: snapshot.treasuryAddress,
        Unauthorize: affectedAddress,
      },
      snapshotFingerprint: authorizationFingerprint(snapshot, policy),
    };
    report.repairPlan = plan;
  }

  return report;
}
