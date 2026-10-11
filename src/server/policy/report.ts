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
import { evaluateIntended, PolicyInputError } from './evaluate.js';
import { authorizationFingerprint } from './fingerprint.js';

export const CHECK_ACTORS: readonly ActorRole[] = ['validCustomer', 'legacyCustomer', 'stranger'];

/** DepositAuth's validated rejection. Other tec/tem/ter codes are not permission evidence. */
const AUTHORIZATION_DENIAL = 'tecNO_PERMISSION';

function hasTransactionEvidence(observation: PaymentObservation): boolean {
  return typeof observation.transactionHash === 'string' && observation.transactionHash.length > 0 && typeof observation.resultCode === 'string' && observation.resultCode.length > 0;
}

/**
 * A definitive allowed result needs a validated tesSUCCESS and a hash.
 * A definitive blocked result needs a validated tecNO_PERMISSION and a hash.
 * Timeouts, transport failures, unvalidated results, insufficient funds,
 * contradictory codes, and missing evidence stay inconclusive.
 */
export function classifyObservation(observation: PaymentObservation): PaymentObservation {
  const copy: PaymentObservation = { ...observation };
  if (copy.observed === 'inconclusive' || copy.validated !== true || !hasTransactionEvidence(copy)) {
    const inconclusive: PaymentObservation = { ...copy, observed: 'inconclusive' };
    if (!copy.error && copy.validated === true && !hasTransactionEvidence(copy)) {
      inconclusive.error = 'The observation is missing transaction evidence, so the authorization outcome is inconclusive.';
    }
    return inconclusive;
  }

  if (copy.observed === 'allowed' && copy.resultCode === 'tesSUCCESS') {
    return copy;
  }
  if (copy.observed === 'blocked' && copy.resultCode === AUTHORIZATION_DENIAL) {
    return copy;
  }

  return {
    ...copy,
    observed: 'inconclusive',
    error:
      copy.error ??
      `Result ${copy.resultCode ?? 'unknown'} does not establish a validated authorization outcome (${copy.observed === 'allowed' ? 'tesSUCCESS' : AUTHORIZATION_DENIAL}).`,
  };
}

function verdictFor(expected: 'allowed' | 'blocked', observed: Outcome): CheckRow['verdict'] {
  if (observed === 'inconclusive') {
    return 'inconclusive';
  }
  return observed === expected ? 'match' : 'mismatch';
}

export function assertUniqueDemoActors(snapshot: AccountSnapshot): Map<ActorRole, Actor> {
  const found = new Map<ActorRole, Actor>();
  for (const actor of snapshot.actors) {
    if (!CHECK_ACTORS.includes(actor.role)) {
      throw new PolicyInputError(`Snapshot actor role ${String(actor.role)} is outside the controlled demo.`);
    }
    if (found.has(actor.role)) {
      throw new PolicyInputError(`Snapshot actor role ${actor.role} appears more than once.`);
    }
    found.set(actor.role, actor);
  }
  for (const role of CHECK_ACTORS) {
    if (!found.has(role)) {
      throw new PolicyInputError(`Snapshot is missing the required ${role} actor.`);
    }
  }
  return found;
}

function indexObservations(observations: PaymentObservation[]): Map<ActorRole, PaymentObservation> {
  const classified = new Map<ActorRole, PaymentObservation>();
  for (const observation of observations) {
    if (!CHECK_ACTORS.includes(observation.actor)) {
      throw new PolicyInputError(`Observation actor ${String(observation.actor)} is outside the controlled demo.`);
    }
    if (classified.has(observation.actor)) {
      throw new PolicyInputError(`Duplicate observation for ${observation.actor}.`);
    }
    classified.set(observation.actor, classifyObservation(observation));
  }
  return classified;
}

function explain(input: {
  actor: Actor;
  expected: 'allowed' | 'blocked';
  reason: string;
  observed: Outcome;
  snapshot: AccountSnapshot;
  observation: PaymentObservation;
  repaired: boolean;
  repairDeferred: boolean;
  repairSuppressedReason?: string;
  additionalConflicts: boolean;
}): string {
  const { actor, expected, reason, observed, snapshot, observation } = input;
  const code = observation.resultCode ? ` Result code ${observation.resultCode}.` : '';
  const detail = observation.error ? ` ${observation.error}` : '';
  const expectation = `Intended policy expected ${expected}. ${reason}`;

  if (observed === 'inconclusive') {
    return `${expectation} The ledger did not establish an authorization outcome.${code}${detail} This is not evidence that the payment was blocked.`;
  }

  if (expected === observed) {
    const ledger =
      observed === 'allowed'
        ? `The validated ledger result allowed the payment.${code}`
        : `The validated ledger result denied the payment.${code}`;
    const setting = snapshot.depositAuthEnabled
      ? 'Deposit Authorization is enabled on the inspected account.'
      : 'Deposit Authorization is not enabled on the inspected account.';
    return `${expectation} ${ledger} ${setting} This check matched.`;
  }

  if (expected === 'blocked' && observed === 'allowed') {
    if (!snapshot.depositAuthEnabled) {
      const approvalNote = actor.individuallyApproved
        ? ' A direct account preauthorization is present, but removing it would not show that the rule is enforced while Deposit Authorization is off.'
        : '';
      return `${expectation} The validated ledger result allowed the payment.${code} Deposit Authorization is not enabled.${approvalNote} No repair is proposed.`;
    }
    if (actor.individuallyApproved && !input.repairDeferred && input.repaired) {
      const limit = input.additionalConflicts
        ? ' The report stores only one repair plan. Other conflicts are not included in this plan.'
        : '';
      return `${expectation} The validated ledger result allowed the payment.${code} The snapshot shows a direct account preauthorization. That approval is ledger state, not an intended exception. The repair removes only this direct approval.${limit}`;
    }
    if (actor.individuallyApproved && input.repairDeferred) {
      const why = input.repairSuppressedReason ?? 'A ledger repair preview was not stored, so no transaction was submitted.';
      return `${expectation} The validated ledger result allowed the payment.${code} The snapshot shows a direct account preauthorization. ${why}`;
    }
    if (actor.individuallyApproved && input.additionalConflicts) {
      return `${expectation} The validated ledger result allowed the payment.${code} The snapshot shows a direct account preauthorization. The report stores only one repair plan. Other conflicts are not included in this plan.`;
    }
    return `${expectation} The validated ledger result allowed the payment.${code} The snapshot does not show a direct account preauthorization for this address, so no single-approval repair is proposed.`;
  }

  return `${expectation} The validated ledger result denied the payment.${code} This is missing authorization, not an extra direct approval, so no Unauthorize repair is proposed.`;
}

function isRepairCandidate(actor: Actor, expected: 'allowed' | 'blocked', observation: PaymentObservation, snapshot: AccountSnapshot, policy: IntendedPolicy): boolean {
  return (
    expected === 'blocked' &&
    observation.observed === 'allowed' &&
    observation.validated === true &&
    typeof observation.transactionHash === 'string' &&
    observation.transactionHash.length > 0 &&
    observation.resultCode === 'tesSUCCESS' &&
    actor.individuallyApproved &&
    snapshot.depositAuthEnabled &&
    !policy.individualExceptions.includes(actor.address)
  );
}

export function buildReport(input: {
  phase: Phase;
  snapshot: AccountSnapshot;
  policy: IntendedPolicy;
  observations: PaymentObservation[];
  completedAt?: string;
  planId?: string;
  includeRepair?: boolean;
  repairSuppressedReason?: string;
}): Report {
  const snapshot = structuredClone(input.snapshot);
  const policy = structuredClone(input.policy);
  const observations = input.observations.map((observation) => structuredClone(observation));
  const actorsByRole = assertUniqueDemoActors(snapshot);
  const classified = indexObservations(observations);

  const draft: Array<{ actor: Actor; observation: PaymentObservation; expected: 'allowed' | 'blocked'; reason: string }> = [];
  for (const role of CHECK_ACTORS) {
    const actor = actorsByRole.get(role);
    if (!actor) {
      throw new PolicyInputError(`Snapshot is missing the required ${role} actor.`);
    }
    const decision = evaluateIntended(actor, policy, snapshot);
    const observation = classified.get(role) ?? {
      actor: role,
      observed: 'inconclusive' as const,
      validated: false,
      error: 'No payment observation was returned for this actor.',
    };
    draft.push({ actor, observation, expected: decision.expected, reason: decision.reason });
  }

  const candidateIndexes = draft.flatMap((item, index) =>
    isRepairCandidate(item.actor, item.expected, item.observation, snapshot, policy) ? [index] : [],
  );
  const repairIndex = input.includeRepair === false ? -1 : (candidateIndexes[0] ?? -1);
  const deferredIndex = input.includeRepair === false ? (candidateIndexes[0] ?? -1) : -1;

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
        reason: item.reason,
        observed,
        snapshot,
        observation: item.observation,
        repaired: index === repairIndex,
        repairDeferred: index === deferredIndex,
        repairSuppressedReason: input.repairSuppressedReason,
        additionalConflicts: candidateIndexes.length > 1 && candidateIndexes.includes(index),
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

  const repairTarget = repairIndex >= 0 ? draft[repairIndex] : undefined;
  if (repairTarget) {
    const affectedAddress = repairTarget.actor.address;
    const limit =
      candidateIndexes.length > 1
        ? ' Only this address is included. The shared report type permits one plan, so other conflicts still need a later check.'
        : '';
    const plan: RepairPlan = {
      id: input.planId ?? randomUUID(),
      description: `Testnet configuration change: remove the direct DepositPreauth approval for ${affectedAddress}. Intended policy does not list this address as an exception. Credential rules and every other approval stay in place.${limit}`,
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
