import type { ActorRole, AccountSnapshot, RepairPlan } from '../../shared/contracts.js';
import type { LedgerPort, RepairExecution } from './ledgerPort.js';
import { redactError } from './redact.js';
import {
  credentialStatusFromRead,
  projectPayment,
  projectStoredRepair,
  REPAIR_APPROVER,
  type CredentialRead,
  type LedgerReceipt,
} from './ledgerMap.js';

export interface AAccounts {
  company: string;
  alice: string;
  bob: string;
  charlie: string;
  issuer: string;
}

export interface ACredentialRef {
  subject: string;
  issuer: string;
  credentialType: string;
}

export interface ACredentialState extends CredentialRead {
  expiration: number | null;
}

export interface APermissions {
  account: string;
  ledgerIndex: number;
  depositAuth: boolean;
  directApprovals: Array<{ account: string }>;
  credentialApprovals: Array<{ credentials: Array<{ issuer: string; credentialType: string }> }>;
  fingerprint: string;
}

export interface ARepairPlan {
  id: string;
  summary: string;
  company: string;
  target: string;
  stateFingerprint: string;
  transaction: {
    TransactionType: string;
    Account?: string;
    Unauthorize?: string;
  };
}

export interface ARepairApproval {
  approved: true;
  planId: string;
  approvedBy: string;
}

export interface ALedgerModule {
  CUSTOMER_TYPE: string;
  connectLedger: () => Promise<{ network: string }>;
  createTestAccounts: () => Promise<AAccounts>;
  setupPermissions: (accounts: AAccounts) => Promise<{ receipts: LedgerReceipt[] }>;
  readPermissions: (company: string, refs?: ACredentialRef[]) => Promise<APermissions>;
  readCredential: (ref: ACredentialRef) => Promise<ACredentialState>;
  testPayment: (sender: string, company: string, credentialIds?: string[]) => Promise<LedgerReceipt>;
  previewRemoveDirectApproval: (company: string, target: string, refs?: ACredentialRef[]) => Promise<ARepairPlan>;
  removeDirectApproval: (planId: string, approval: ARepairApproval) => Promise<{ receipt: LedgerReceipt }>;
  customerRefs: (accounts: AAccounts) => ACredentialRef[];
}

const ACTOR_TO_ROLE = {
  validCustomer: 'alice',
  legacyCustomer: 'bob',
  stranger: 'charlie',
} as const satisfies Record<ActorRole, keyof AAccounts>;

export interface DemoSession {
  accounts: AAccounts;
  network: string;
  credentialType: string;
  /** Subjects whose credential delete/revoke validated during this setup. */
  revokedSubjects: ReadonlySet<string>;
  /** Full ledger receipts. Never copied onto the public session. */
  evidence: LedgerReceipt[];
}

const REQUIRED_FUNCTIONS = [
  'connectLedger',
  'createTestAccounts',
  'setupPermissions',
  'readPermissions',
  'readCredential',
  'testPayment',
  'previewRemoveDirectApproval',
  'removeDirectApproval',
  'customerRefs',
] as const;

export function missingAExports(mod: Partial<ALedgerModule>): string[] {
  const missing: string[] = [];
  if (typeof mod.CUSTOMER_TYPE !== 'string' || mod.CUSTOMER_TYPE.length === 0) {
    missing.push('CUSTOMER_TYPE');
  }
  for (const name of REQUIRED_FUNCTIONS) {
    if (typeof mod[name] !== 'function') {
      missing.push(name);
    }
  }
  return missing;
}

function asDemoSession(session: unknown): DemoSession {
  if (typeof session !== 'object' || session === null || !('accounts' in session) || !('evidence' in session)) {
    throw new Error('Ledger session is missing disposable account addresses.');
  }
  return session as DemoSession;
}

function actorAddress(session: DemoSession, actor: ActorRole): string {
  return session.accounts[ACTOR_TO_ROLE[actor]];
}

async function readActorCredential(mod: ALedgerModule, session: DemoSession, actor: ActorRole): Promise<ACredentialState> {
  return mod.readCredential({
    subject: actorAddress(session, actor),
    issuer: session.accounts.issuer,
    credentialType: session.credentialType,
  });
}

export function createALedgerPort(mod: ALedgerModule): LedgerPort {
  return {
    async createDemoEnvironment(onProgress) {
      onProgress('Connecting to the XRPL test network');
      const proof = await mod.connectLedger();
      onProgress('Creating disposable test accounts');
      const accounts = await mod.createTestAccounts();
      onProgress('Configuring deposit authorization, credentials, and the legacy direct approval');
      await mod.setupPermissions(accounts);
      const session: DemoSession = {
        accounts,
        network: proof.network,
        credentialType: mod.CUSTOMER_TYPE,
        revokedSubjects: new Set([accounts.bob]),
        evidence: [],
      };
      return session;
    },

    async readSnapshot(session): Promise<AccountSnapshot> {
      const demo = asDemoSession(session);
      const refs = mod.customerRefs(demo.accounts);
      const permissions = await mod.readPermissions(demo.accounts.company, refs);
      const actors: AccountSnapshot['actors'] = [];
      for (const role of ['validCustomer', 'legacyCustomer', 'stranger'] as const) {
        const credential = await readActorCredential(mod, demo, role);
        actors.push({
          role,
          address: credential.subject,
          credentialStatus: credentialStatusFromRead(credential, demo.revokedSubjects),
          individuallyApproved: permissions.directApprovals.some((approval) => approval.account === credential.subject),
        });
      }
      return {
        network: demo.network,
        ledgerIndex: permissions.ledgerIndex,
        treasuryAddress: demo.accounts.company,
        issuerAddress: demo.accounts.issuer,
        credentialType: demo.credentialType,
        depositAuthEnabled: permissions.depositAuth,
        trustedCredentialRulePresent: permissions.credentialApprovals.some((rule) =>
          rule.credentials.some(
            (credential) => credential.issuer === demo.accounts.issuer && credential.credentialType === demo.credentialType,
          ),
        ),
        actors,
        capturedAt: new Date().toISOString(),
      };
    },

    async sendTestPayment(session, actor) {
      const demo = asDemoSession(session);
      const sender = actorAddress(demo, actor);
      let credential: ACredentialState;
      try {
        credential = await readActorCredential(mod, demo, actor);
      } catch (error) {
        return {
          actor,
          observed: 'inconclusive' as const,
          validated: false,
          error: `Credential read failed and is inconclusive. ${redactError(error)}`,
        };
      }

      const current = credential.exists && credential.accepted && !credential.expired && credential.id ? credential.id : null;
      // Legacy and stranger always omit CredentialIDs, even if a credential object is still visible.
      const receipt =
        actor === 'legacyCustomer' || actor === 'stranger'
          ? await mod.testPayment(sender, demo.accounts.company, [])
          : await mod.testPayment(sender, demo.accounts.company, current ? [current] : []);
      demo.evidence.push(receipt);
      return projectPayment(actor, receipt);
    },

    async previewDirectApprovalRepair(session, address): Promise<RepairPlan> {
      const demo = asDemoSession(session);
      const preview = await mod.previewRemoveDirectApproval(demo.accounts.company, address, mod.customerRefs(demo.accounts));
      return projectStoredRepair(preview, demo.network);
    },

    async executeStoredRepair(session, plan): Promise<RepairExecution> {
      asDemoSession(session);
      const approval: ARepairApproval = { approved: true, planId: plan.id, approvedBy: REPAIR_APPROVER };
      const result = await mod.removeDirectApproval(plan.id, approval);
      const receipt = result.receipt;
      if (receipt.resultCode === 'INCONCLUSIVE' || receipt.successful === null || receipt.validated !== true) {
        throw new Error(
          `Repair outcome is inconclusive (${receipt.resultCode}). Hash ${receipt.transactionHash} is retained. This plan will not be resubmitted.`,
        );
      }
      if (receipt.resultCode !== 'tesSUCCESS' || receipt.successful !== true) {
        throw new Error(`Repair result ${receipt.resultCode} was not a validated tesSUCCESS. Hash ${receipt.transactionHash}.`);
      }
      return { transactionHash: receipt.transactionHash, resultCode: receipt.resultCode, validated: true };
    },
  };
}
