import type { AccountSnapshot, ActorRole, PaymentObservation } from '../../shared/contracts.js';

export interface RepairExecution {
  transactionHash: string;
  resultCode: string;
  validated: true;
}

/**
 * Private adapter matching the agreed ledger exports.
 * LedgerSession stays opaque and is never serialized.
 */
export interface LedgerPort {
  createDemoEnvironment(onProgress: (message: string) => void): Promise<unknown>;
  readSnapshot(session: unknown): Promise<AccountSnapshot>;
  sendTestPayment(session: unknown, actor: ActorRole): Promise<PaymentObservation>;
  removeIndividualApproval(session: unknown, address: string): Promise<RepairExecution>;
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
    removeIndividualApproval() {
      return fail();
    },
  };
}
