import type { ActorRole, PaymentObservation, RepairPlan } from '../../shared/contracts.js';
import { repairConfigurationLabel } from '../policy/report.js';

/** Subset of teammate A's TransactionResult. Extra ledger fields stay internal. */
export interface LedgerReceipt {
  transactionHash: string;
  validated: boolean;
  resultCode: string;
  successful: boolean | null;
  ledgerIndex: number | null;
  sender: string;
  sequence: number;
  lastLedgerSequence: number;
  error?: string;
}

export interface CredentialRead {
  subject: string;
  issuer: string;
  credentialType: string;
  id: string | null;
  exists: boolean;
  accepted: boolean;
  expired: boolean;
}

export interface StoredRepairPreview {
  id: string;
  summary: string;
  target: string;
  stateFingerprint: string;
  transaction: {
    TransactionType: string;
    Account?: string;
    Unauthorize?: string;
  };
}

export const REPAIR_APPROVER = 'gatecheck-operator';

/**
 * `valid` requires a current accepted credential id from the snapshot issuer and type.
 * A missing credential is `none` unless this session already recorded a revoke/delete.
 * This function does not classify RPC failures; callers must keep those inconclusive.
 */
export function credentialStatusFromRead(
  credential: CredentialRead,
  revokedSubjects: ReadonlySet<string>,
): 'valid' | 'revoked' | 'none' {
  if (credential.exists && credential.accepted && !credential.expired && credential.id) {
    return 'valid';
  }
  if (revokedSubjects.has(credential.subject)) {
    return 'revoked';
  }
  return 'none';
}

export function projectPayment(actor: ActorRole, receipt: LedgerReceipt): PaymentObservation {
  const projected: PaymentObservation = {
    actor,
    validated: receipt.validated,
    observed: 'inconclusive',
    transactionHash: receipt.transactionHash,
    resultCode: receipt.resultCode,
  };
  if (receipt.error) {
    projected.error = receipt.error;
  }

  const unknown = receipt.resultCode === 'INCONCLUSIVE' || receipt.successful === null || receipt.validated !== true;
  if (unknown) {
    return projected;
  }
  if (receipt.resultCode === 'tesSUCCESS' && receipt.successful === true) {
    return { ...projected, observed: 'allowed' };
  }
  if (receipt.resultCode === 'tecNO_PERMISSION' && receipt.successful === false) {
    return { ...projected, observed: 'blocked' };
  }
  return {
    ...projected,
    error: receipt.error ?? `Result ${receipt.resultCode} is not an authorization decision.`,
  };
}

export function projectStoredRepair(plan: StoredRepairPreview, network: string): RepairPlan {
  if (plan.transaction.TransactionType !== 'DepositPreauth' || !plan.transaction.Account || !plan.transaction.Unauthorize) {
    throw new Error('Stored repair preview is not a DepositPreauth Unauthorize.');
  }
  if (plan.transaction.Unauthorize !== plan.target) {
    throw new Error('Stored repair preview does not target the reviewed address.');
  }
  return {
    id: plan.id,
    description: `${repairConfigurationLabel(network)}: ${plan.summary}`,
    affectedAddress: plan.target,
    unsignedTransaction: {
      TransactionType: 'DepositPreauth',
      Account: plan.transaction.Account,
      Unauthorize: plan.transaction.Unauthorize,
    },
    snapshotFingerprint: plan.stateFingerprint,
  };
}

export function isStaleRepairError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return /state changed|expired|no longer exists|already submitted|network mismatch|Invalid plan|No direct wallet approval/i.test(message);
}
