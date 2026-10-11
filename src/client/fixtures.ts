import type {
  AccountSnapshot,
  Actor,
  CheckRow,
  IntendedPolicy,
  PublicSession,
  Report,
} from '../shared/contracts';

export type FixtureScenario = 'empty' | 'loading' | 'error' | 'before' | 'inconclusive' | 'after';

const treasury = 'rFixtureTreasury111111111111111111';
const issuer = 'rFixtureIssuer1111111111111111111';
const validCustomer = 'rFixtureValidCustomer11111111111';
const legacyCustomer = 'rFixtureLegacyCustomer1111111111';
const stranger = 'rFixtureStranger1111111111111111';

const validHash = 'f17c000000000000000000000000000000000000000000000000000000000001';
const legacyAllowedHash = 'f17c000000000000000000000000000000000000000000000000000000000002';
const strangerHash = 'f17c000000000000000000000000000000000000000000000000000000000003';
const legacyBlockedHash = 'f17c000000000000000000000000000000000000000000000000000000000004';
const repairHash = 'f17c000000000000000000000000000000000000000000000000000000000005';

const policy: IntendedPolicy = {
  trustedIssuer: issuer,
  credentialType: 'CustomerCredential',
  requireCurrentAcceptedCredential: true,
  individualExceptions: [],
};

function actors(legacyApproved: boolean): Actor[] {
  return [
    {
      role: 'validCustomer',
      address: validCustomer,
      credentialStatus: 'valid',
      individuallyApproved: false,
    },
    {
      role: 'legacyCustomer',
      address: legacyCustomer,
      credentialStatus: 'revoked',
      individuallyApproved: legacyApproved,
    },
    {
      role: 'stranger',
      address: stranger,
      credentialStatus: 'none',
      individuallyApproved: false,
    },
  ];
}

function snapshot(legacyApproved: boolean, capturedAt: string): AccountSnapshot {
  return {
    network: 'testnet',
    ledgerIndex: legacyApproved ? 881234 : 881240,
    treasuryAddress: treasury,
    issuerAddress: issuer,
    credentialType: 'CustomerCredential',
    depositAuthEnabled: true,
    trustedCredentialRulePresent: true,
    actors: actors(legacyApproved),
    capturedAt,
  };
}

const beforeSnapshot = snapshot(true, '2026-10-11T21:10:00.000Z');
const afterSnapshot = snapshot(false, '2026-10-11T21:20:00.000Z');

const validRow: CheckRow = {
  actor: 'validCustomer',
  expected: 'allowed',
  observed: 'allowed',
  verdict: 'match',
  validated: true,
  transactionHash: validHash,
  resultCode: 'tesSUCCESS',
  explanation: 'The valid customer payment validated as allowed with a current accepted credential.',
};

const legacyMismatch: CheckRow = {
  actor: 'legacyCustomer',
  expected: 'blocked',
  observed: 'allowed',
  verdict: 'mismatch',
  validated: true,
  transactionHash: legacyAllowedHash,
  resultCode: 'tesSUCCESS',
  explanation:
    'The legacy customer payment validated as allowed, but the intended policy expects a block. The credential is revoked, no individual exception is intended, and the snapshot still shows a direct approval for this address.',
};

const strangerRow: CheckRow = {
  actor: 'stranger',
  expected: 'blocked',
  observed: 'blocked',
  verdict: 'match',
  validated: true,
  transactionHash: strangerHash,
  resultCode: 'tecNO_PERMISSION',
  explanation: 'The stranger payment validated as blocked. That matches the intended policy.',
};

const inconclusiveRow: CheckRow = {
  actor: 'legacyCustomer',
  expected: 'blocked',
  observed: 'inconclusive',
  verdict: 'inconclusive',
  validated: false,
  error: 'Validation timed out before a ledger result was available.',
  explanation:
    'The outcome is inconclusive. A timeout is not a blocked payment, and this row does not justify a repair.',
};

const legacyBlocked: CheckRow = {
  actor: 'legacyCustomer',
  expected: 'blocked',
  observed: 'blocked',
  verdict: 'match',
  validated: true,
  transactionHash: legacyBlockedHash,
  resultCode: 'tecNO_PERMISSION',
  explanation:
    'The legacy customer payment validated as blocked after the direct approval was removed. That matches the intended policy.',
};

const repairPlan: Report['repairPlan'] = {
  id: 'fixture-plan-legacy-approval',
  description:
    'Remove the direct preauthorization for the legacy customer. This preview is a testnet configuration change for the address below.',
  affectedAddress: legacyCustomer,
  unsignedTransaction: {
    TransactionType: 'DepositPreauth',
    Account: treasury,
    Unauthorize: legacyCustomer,
  },
  snapshotFingerprint: 'fixture-auth-state-v1',
};

function report(id: string, phase: Report['phase'], source: AccountSnapshot, rows: CheckRow[], plan?: Report['repairPlan']): Report {
  return {
    id,
    phase,
    snapshot: source,
    policy,
    rows,
    repairPlan: plan,
    completedAt: source.capturedAt,
  };
}

const beforeReport = report('fixture-before', 'before', beforeSnapshot, [validRow, legacyMismatch, strangerRow], repairPlan);
const afterReport = report('fixture-after', 'after', afterSnapshot, [validRow, legacyBlocked, strangerRow]);
const inconclusiveReport = report('fixture-inconclusive', 'before', beforeSnapshot, [validRow, inconclusiveRow, strangerRow]);

export function buildFixtureSession(scenario: FixtureScenario): PublicSession | null {
  if (scenario === 'empty') {
    return null;
  }
  if (scenario === 'loading') {
    return {
      id: 'fixture-loading',
      status: 'settingUp',
      network: 'testnet',
      progress: 'Loading preview: funding would be reported here while setup is running.',
      reports: [],
    };
  }
  if (scenario === 'error') {
    return {
      id: 'fixture-error',
      status: 'error',
      network: 'testnet',
      progress: 'Setup stopped',
      reports: [],
      error: 'Preview error: the session API did not return an environment. No payments were submitted.',
    };
  }
  if (scenario === 'inconclusive') {
    return {
      id: 'fixture-inconclusive',
      status: 'ready',
      network: 'testnet',
      progress: 'Checks finished with an inconclusive row',
      snapshot: beforeSnapshot,
      reports: [inconclusiveReport],
    };
  }
  if (scenario === 'after') {
    return {
      id: 'fixture-after',
      status: 'ready',
      network: 'testnet',
      progress: 'After checks finished',
      snapshot: afterSnapshot,
      reports: [beforeReport, afterReport],
      repairReceipt: {
        transactionHash: repairHash,
        resultCode: 'tesSUCCESS',
        validated: true,
      },
    };
  }
  return {
    id: 'fixture-before',
    status: 'ready',
    network: 'testnet',
    progress: 'Before checks finished',
    snapshot: beforeSnapshot,
    reports: [beforeReport],
  };
}
