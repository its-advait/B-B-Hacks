import { randomUUID } from 'node:crypto';
import type { AccountSnapshot, ActorRole, PaymentObservation, RepairPlan } from '../../shared/contracts.js';
import { deriveIntendedPolicy } from '../policy/evaluate.js';
import { authorizationFingerprint } from '../policy/fingerprint.js';
import { repairConfigurationLabel } from '../policy/report.js';
import type { LedgerPort, RepairExecution } from './ledgerPort.js';

/**
 * Teammate A's frozen compatibility surface from src/server/ledger/index.ts.
 * Repair execution calls removeIndividualApproval, which reuses the preview
 * stored inside that module. This adapter does not write a second plan file.
 */
export interface FrozenLedgerModule {
  createDemoEnvironment: (onProgress: (message: string) => void) => Promise<unknown>;
  readSnapshot: (session: unknown) => Promise<AccountSnapshot>;
  sendTestPayment: (session: unknown, actor: ActorRole) => Promise<PaymentObservation>;
  removeIndividualApproval: (session: unknown, address: string) => Promise<RepairExecution>;
}

const FROZEN_EXPORTS = ['createDemoEnvironment', 'readSnapshot', 'sendTestPayment', 'removeIndividualApproval'] as const;

export function hasFrozenLedgerExports(mod: object): mod is FrozenLedgerModule {
  const source = mod as Record<string, unknown>;
  return FROZEN_EXPORTS.every((name) => typeof source[name] === 'function');
}

export function createFrozenLedgerPort(mod: FrozenLedgerModule): LedgerPort {
  return {
    createDemoEnvironment(onProgress) {
      return mod.createDemoEnvironment(onProgress);
    },
    readSnapshot(session) {
      return mod.readSnapshot(session);
    },
    sendTestPayment(session, actor) {
      return mod.sendTestPayment(session, actor);
    },
    async previewDirectApprovalRepair(session, address) {
      const snapshot = await mod.readSnapshot(session);
      const actor = snapshot.actors.find((item) => item.address === address);
      if (!snapshot.depositAuthEnabled || !actor?.individuallyApproved) {
        throw new Error('No direct wallet approval to remove');
      }
      return {
        id: randomUUID(),
        description: `${repairConfigurationLabel(snapshot.network)}: remove the direct DepositPreauth approval for ${address}. Credential rules and every other approval stay in place.`,
        affectedAddress: address,
        unsignedTransaction: {
          TransactionType: 'DepositPreauth',
          Account: snapshot.treasuryAddress,
          Unauthorize: address,
        },
        snapshotFingerprint: authorizationFingerprint(snapshot, deriveIntendedPolicy(snapshot)),
      } satisfies RepairPlan;
    },
    async executeStoredRepair(session, plan) {
      return mod.removeIndividualApproval(session, plan.affectedAddress);
    },
  };
}
