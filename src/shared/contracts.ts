export type ActorRole = 'validCustomer' | 'legacyCustomer' | 'stranger';
export type Outcome = 'allowed' | 'blocked' | 'inconclusive';
export type Phase = 'before' | 'after';
export type SessionStatus = 'settingUp' | 'ready' | 'checking' | 'repairing' | 'error';

export interface Actor {
  role: ActorRole;
  address: string;
  credentialStatus: 'valid' | 'revoked' | 'none';
  individuallyApproved: boolean;
}
export interface AccountSnapshot {
  network: string;
  ledgerIndex: number;
  treasuryAddress: string;
  issuerAddress: string;
  credentialType: string;
  depositAuthEnabled: boolean;
  trustedCredentialRulePresent: boolean;
  actors: Actor[];
  capturedAt: string;
}
export interface IntendedPolicy {
  trustedIssuer: string;
  credentialType: string;
  requireCurrentAcceptedCredential: true;
  individualExceptions: string[];
}
export interface PaymentObservation {
  actor: ActorRole;
  observed: Outcome;
  validated: boolean;
  transactionHash?: string;
  resultCode?: string;
  error?: string;
}
export interface CheckRow extends PaymentObservation {
  expected: 'allowed' | 'blocked';
  verdict: 'match' | 'mismatch' | 'inconclusive';
  explanation: string;
}
export interface RepairPlan {
  id: string;
  description: string;
  affectedAddress: string;
  unsignedTransaction: {
    TransactionType: 'DepositPreauth';
    Account: string;
    Unauthorize: string;
  };
  snapshotFingerprint: string;
}
export interface Report {
  id: string;
  phase: Phase;
  snapshot: AccountSnapshot;
  policy: IntendedPolicy;
  rows: CheckRow[];
  repairPlan?: RepairPlan;
  completedAt: string;
}
export interface PublicSession {
  id: string;
  status: SessionStatus;
  network: string;
  progress: string;
  snapshot?: AccountSnapshot;
  reports: Report[];
  repairReceipt?: { transactionHash: string; resultCode: string; validated: true };
  error?: string;
}
