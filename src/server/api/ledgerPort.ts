import type { AccountSnapshot, ActorRole, PaymentObservation, RepairPlan } from '../../shared/contracts.js';

export interface RepairExecution {
  transactionHash: string;
  resultCode: string;
  validated: true;
}

/**
 * Session-facing port. The live implementation calls teammate A's module.
 * Ledger sessions stay opaque and are never serialized.
 */
export interface LedgerPort {
  createDemoEnvironment(onProgress: (message: string) => void): Promise<unknown>;
  readSnapshot(session: unknown): Promise<AccountSnapshot>;
  sendTestPayment(session: unknown, actor: ActorRole): Promise<PaymentObservation>;
  previewDirectApprovalRepair(session: unknown, address: string): Promise<RepairPlan>;
  executeStoredRepair(session: unknown, planId: string): Promise<RepairExecution>;
}

export class LedgerUnavailableError extends Error {
  readonly code = 'ledger_unavailable';

  constructor(message: string) {
    super(message);
    this.name = 'LedgerUnavailableError';
  }
}

export function unavailableLedgerPort(reason: string): LedgerPort {
  const fail = (): Promise<never> => Promise.reject(new LedgerUnavailableError(reason));
  return {
    createDemoEnvironment() {
      return fail();
    },
    readSnapshot() {
      return fail();
    },
    sendTestPayment() {
      return fail();
    },
    previewDirectApprovalRepair() {
      return fail();
    },
    executeStoredRepair() {
      return fail();
    },
  };
}
