import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AccountSnapshot, IntendedPolicy, Phase, PublicSession, RepairPlan } from '../../shared/contracts.js';
import { ApiError } from './errors.js';
import type { LedgerPort, RepairExecution } from './ledgerPort.js';
import { isStaleRepairError } from './ledgerMap.js';
import { redactError, redactSecrets } from './redact.js';
import { deriveIntendedPolicy } from '../policy/evaluate.js';
import { authorizationFingerprint, repairStaleReason } from '../policy/fingerprint.js';
import { buildReport, CHECK_ACTORS } from '../policy/report.js';

interface PrivateSession {
  public: PublicSession;
  ledger: unknown;
  policy: IntendedPolicy | null;
  busy: boolean;
  activePlan: RepairPlan | null;
  consumedPlanIds: Set<string>;
  uncertainRepair: boolean;
  operationId: string | null;
}

export interface SessionServiceOptions {
  /** Public projections only. Never read back into a live session. */
  publicMetadataDir?: string;
}

export interface SessionService {
  createSession(body: unknown): { sessionId: string };
  getSession(id: string): PublicSession;
  startChecks(id: string, body: unknown): { sessionId: string };
  startRepair(id: string, body: unknown): Promise<{ sessionId: string }>;
}

const BOUNDED_ID = /^[A-Za-z0-9_-]{1,80}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clonePublic(session: PrivateSession): PublicSession {
  return structuredClone(session.public);
}

function requireSession(sessions: Map<string, PrivateSession>, id: string): PrivateSession {
  const session = sessions.get(id);
  if (!session) {
    throw new ApiError(404, 'session_not_found', 'Unknown session. Create a new test environment.');
  }
  return session;
}

function assertIdle(session: PrivateSession): void {
  if (session.busy || session.public.status === 'settingUp' || session.public.status === 'checking' || session.public.status === 'repairing') {
    throw new ApiError(409, 'job_in_progress', 'Another mutation is already running for this session.');
  }
}

function schedulePersist(queue: { current: Promise<void> }, dir: string | undefined, session: PrivateSession): void {
  if (!dir) {
    return;
  }
  const projection = clonePublic(session);
  queue.current = queue.current.then(() => writePublicProjection(dir, projection)).catch(() => {
    // Metadata is a convenience copy. It must not change the live result.
  });
}

async function writePublicProjection(dir: string, projection: PublicSession): Promise<void> {
  const folder = path.join(dir, 'sessions');
  await mkdir(folder, { recursive: true });
  const target = path.join(folder, `${projection.id}.json`);
  const temporary = path.join(folder, `.${projection.id}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(projection));
  await rename(temporary, target);
}

function asSuccessReceipt(value: unknown): RepairExecution | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value.validated !== true || value.resultCode !== 'tesSUCCESS') {
    return undefined;
  }
  if (typeof value.transactionHash !== 'string' || value.transactionHash.length === 0) {
    return undefined;
  }
  return { transactionHash: value.transactionHash, resultCode: 'tesSUCCESS', validated: true };
}

function describeRejectedReceipt(value: unknown): string {
  if (!isRecord(value)) {
    return 'missing receipt';
  }
  const code = typeof value.resultCode === 'string' ? value.resultCode : 'missing result code';
  const hash = typeof value.transactionHash === 'string' && value.transactionHash.length > 0 ? value.transactionHash : 'no hash';
  const validated = value.validated === true ? 'validated' : 'unvalidated';
  return `${validated} ${code} ${hash}`;
}

function verifyRepairEffect(before: AccountSnapshot, after: AccountSnapshot, affectedAddress: string): string | undefined {
  if (before.depositAuthEnabled !== after.depositAuthEnabled) {
    return 'Deposit Authorization changed';
  }
  if (before.trustedCredentialRulePresent !== after.trustedCredentialRulePresent) {
    return 'the trusted credential rule changed';
  }
  if (before.treasuryAddress !== after.treasuryAddress || before.issuerAddress !== after.issuerAddress || before.credentialType !== after.credentialType) {
    return 'treasury, issuer, or credential type changed';
  }
  const affected = after.actors.find((actor) => actor.address === affectedAddress);
  if (!affected) {
    return 'the reviewed actor is missing';
  }
  if (affected.individuallyApproved) {
    return 'the reviewed direct approval is still present';
  }
  for (const prior of before.actors) {
    const next = after.actors.find((actor) => actor.address === prior.address && actor.role === prior.role);
    if (!next) {
      return `actor ${prior.role} is missing after the repair`;
    }
    if (prior.address === affectedAddress) {
      if (next.credentialStatus !== prior.credentialStatus) {
        return 'the reviewed actor credential status changed';
      }
      continue;
    }
    if (next.individuallyApproved !== prior.individuallyApproved || next.credentialStatus !== prior.credentialStatus) {
      return `unrelated actor ${prior.role} changed`;
    }
  }
  return undefined;
}

export function createSessionService(resolveLedger: () => Promise<LedgerPort>, options: SessionServiceOptions = {}): SessionService {
  const sessions = new Map<string, PrivateSession>();
  const metadataDir = options.publicMetadataDir;
  const persistQueue = { current: Promise.resolve() };

  function createSession(body: unknown): { sessionId: string } {
    if (!isRecord(body) || body.approveTestnetSetup !== true) {
      throw new ApiError(400, 'approval_required', 'approveTestnetSetup must be true before creating a test environment.');
    }

    const id = randomUUID();
    const session: PrivateSession = {
      public: {
        id,
        status: 'settingUp',
        network: 'pending',
        progress: 'Creating test environment',
        reports: [],
      },
      ledger: null,
      policy: null,
      busy: true,
      activePlan: null,
      consumedPlanIds: new Set(),
      uncertainRepair: false,
      operationId: randomUUID(),
    };
    sessions.set(id, session);
    schedulePersist(persistQueue, metadataDir, session);
    void runSetup(session).catch((error) => {
      failClosed(session, 'Setup failed', error);
    });
    return { sessionId: id };
  }

  function failClosed(session: PrivateSession, progress: string, error: unknown): void {
    session.ledger = null;
    session.policy = null;
    session.public.status = 'error';
    session.public.error = redactError(error);
    session.public.progress = progress;
    session.busy = false;
    session.operationId = null;
    schedulePersist(persistQueue, metadataDir, session);
  }

  async function runSetup(session: PrivateSession): Promise<void> {
    try {
      const port = await resolveLedger();
      session.ledger = await port.createDemoEnvironment((message) => {
        session.public.progress = redactSecrets(message);
        schedulePersist(persistQueue, metadataDir, session);
      });
      const snapshot = await port.readSnapshot(session.ledger);
      if (snapshot.network !== 'devnet' && snapshot.network !== 'testnet') {
        throw new Error('Only the supported test networks are accepted. This server has no mainnet signing path.');
      }
      session.public.snapshot = structuredClone(snapshot);
      session.public.network = snapshot.network;
      session.policy = deriveIntendedPolicy(snapshot);
      session.public.error = undefined;
      session.public.status = 'ready';
      session.public.progress = 'Test environment ready';
    } catch (error) {
      session.ledger = null;
      session.policy = null;
      session.public.status = 'error';
      session.public.error = redactError(error);
      session.public.progress = 'Setup failed';
    } finally {
      session.busy = false;
      session.operationId = null;
      schedulePersist(persistQueue, metadataDir, session);
    }
  }

  function getSession(id: string): PublicSession {
    return clonePublic(requireSession(sessions, id));
  }

  function startChecks(id: string, body: unknown): { sessionId: string } {
    const session = requireSession(sessions, id);
    if (!isRecord(body) || body.approveTestPayments !== true) {
      throw new ApiError(400, 'approval_required', 'approveTestPayments must be true before test payments run.');
    }
    const phase = body.phase;
    if (phase !== 'before' && phase !== 'after') {
      throw new ApiError(409, 'invalid_phase', 'Phase must be before or after.');
    }

    assertIdle(session);
    if (!session.ledger || !session.policy) {
      throw new ApiError(409, 'invalid_phase', 'The test environment is not ready. Recreate the session if setup failed.');
    }
    if (phase === 'after' && session.public.repairReceipt?.validated !== true) {
      throw new ApiError(409, 'invalid_phase', 'After checks require a validated repair receipt. Approve the stored plan first.');
    }

    session.busy = true;
    session.operationId = randomUUID();
    session.public.status = 'checking';
    session.public.error = undefined;
    session.public.progress = phase === 'before' ? 'Starting before checks' : 'Starting after checks';
    schedulePersist(persistQueue, metadataDir, session);
    void runChecks(session, phase).catch((error) => {
      session.public.status = 'error';
      session.public.error = redactError(error);
      session.public.progress = 'Checks failed';
      session.busy = false;
      session.operationId = null;
      schedulePersist(persistQueue, metadataDir, session);
    });
    return { sessionId: id };
  }

  async function runChecks(session: PrivateSession, phase: Phase): Promise<void> {
    try {
      const port = await resolveLedger();
      const policy = session.policy;
      if (!policy || !session.ledger) {
        throw new ApiError(409, 'invalid_phase', 'The test environment is not ready.');
      }

      session.public.progress = 'Reading ledger snapshot';
      const beforeSnapshot = await port.readSnapshot(session.ledger);
      const beforeFingerprint = authorizationFingerprint(beforeSnapshot, policy);
      const observations = [];
      for (const actor of CHECK_ACTORS) {
        session.public.progress = `Submitting test payment for ${actor}`;
        try {
          observations.push(await port.sendTestPayment(session.ledger, actor));
        } catch (error) {
          observations.push({
            actor,
            observed: 'inconclusive' as const,
            validated: false,
            error: redactError(error),
          });
        }
      }

      const afterSnapshot = await port.readSnapshot(session.ledger);
      const mixed = authorizationFingerprint(afterSnapshot, policy) !== beforeFingerprint;
      const repairSuppressedReason = mixed
        ? 'Relevant permissions changed while the three payments were running. No repair plan was stored. Rerun checks on stable settings.'
        : undefined;
      let report = buildReport({
        phase,
        snapshot: afterSnapshot,
        policy,
        observations,
        includeRepair: !mixed,
        repairSuppressedReason,
      });
      if (report.repairPlan) {
        const affectedAddress = report.repairPlan.affectedAddress;
        session.public.progress = `Storing repair preview for ${affectedAddress}`;
        try {
          const stored = await port.previewDirectApprovalRepair(session.ledger, affectedAddress);
          report = { ...report, repairPlan: stored };
        } catch (error) {
          report = buildReport({
            phase,
            snapshot: afterSnapshot,
            policy,
            observations,
            includeRepair: false,
            repairSuppressedReason: `A ledger repair preview was not stored (${redactError(error)}), so no transaction was submitted.`,
          });
          session.public.progress = `Repair preview was not stored: ${redactError(error)}`;
        }
      }
      session.public.snapshot = structuredClone(afterSnapshot);
      session.public.network = afterSnapshot.network;
      session.public.reports = [...session.public.reports, structuredClone(report)];
      session.activePlan = report.repairPlan ? structuredClone(report.repairPlan) : null;
      session.public.error = undefined;
      session.public.status = 'ready';
      session.public.progress = mixed
        ? 'Checks finished on mixed ledger state. Rerun checks before repair.'
        : report.repairPlan
          ? 'Checks complete. A repair plan is waiting for review.'
          : 'Checks complete.';
    } catch (error) {
      session.public.status = 'error';
      session.public.error = redactError(error);
      session.public.progress = 'Checks failed';
    } finally {
      session.busy = false;
      session.operationId = null;
      schedulePersist(persistQueue, metadataDir, session);
    }
  }

  function parseRepairBody(body: unknown): string {
    if (!isRecord(body)) {
      throw new ApiError(400, 'invalid_body', 'Repair body must be a JSON object.');
    }
    if (body.approved !== true) {
      throw new ApiError(400, 'approval_required', 'approved must be true before the reviewed repair is submitted.');
    }
    const unexpected = Object.keys(body).filter((key) => key !== 'approved' && key !== 'planId');
    if (unexpected.length > 0) {
      throw new ApiError(400, 'invalid_body', 'Repair accepts only planId and approved. Client transaction fields are rejected.');
    }
    if (typeof body.planId !== 'string' || !BOUNDED_ID.test(body.planId)) {
      throw new ApiError(400, 'invalid_body', 'planId must be the id of a stored repair plan.');
    }
    return body.planId;
  }

  async function startRepair(id: string, body: unknown): Promise<{ sessionId: string }> {
    const session = requireSession(sessions, id);
    const planId = parseRepairBody(body);
    assertIdle(session);
    if (!session.ledger || !session.policy) {
      throw new ApiError(409, 'invalid_phase', 'The test environment is not ready.');
    }
    if (session.uncertainRepair) {
      throw new ApiError(409, 'stale_plan', 'Repair outcome is uncertain. This plan will not be resubmitted. A fresh test environment is required.');
    }
    if (session.consumedPlanIds.has(planId) || session.activePlan?.id !== planId) {
      throw new ApiError(409, 'stale_plan', 'Unknown or outdated repair plan. Rerun checks.');
    }

    const plan = session.activePlan;
    const knownActors = session.public.snapshot?.actors ?? [];
    if (plan.unsignedTransaction.TransactionType !== 'DepositPreauth' || plan.unsignedTransaction.Unauthorize !== plan.affectedAddress) {
      throw new ApiError(409, 'stale_plan', 'Stored repair does not match the reviewed address.');
    }
    if (!session.public.snapshot || plan.unsignedTransaction.Account !== session.public.snapshot.treasuryAddress) {
      throw new ApiError(409, 'stale_plan', 'Stored repair does not match this session treasury.');
    }
    if (!knownActors.some((actor) => actor.address === plan.affectedAddress)) {
      throw new ApiError(409, 'stale_plan', 'Stored repair targets an address outside this session.');
    }

    session.busy = true;
    session.operationId = randomUUID();
    try {
      const port = await resolveLedger();
      const fresh = await port.readSnapshot(session.ledger);
      const actor = fresh.actors.find((item) => item.address === plan.affectedAddress);
      let stale = repairStaleReason(plan, fresh, session.policy);
      if (!stale && !actor) {
        stale = 'The reviewed address is no longer in this session. Rerun checks.';
      } else if (!stale && session.policy.individualExceptions.includes(plan.affectedAddress)) {
        stale = 'The address is an intended exception. No removal was submitted. Rerun checks.';
      } else if (!stale && !fresh.depositAuthEnabled) {
        stale = 'Deposit Authorization is not enabled. No removal was submitted. Rerun checks.';
      } else if (!stale && actor && !actor.individuallyApproved) {
        stale = 'The direct approval is no longer present. Rerun checks.';
      }
      if (stale) {
        session.public.snapshot = structuredClone(fresh);
        session.consumedPlanIds.add(plan.id);
        session.activePlan = null;
        session.public.status = 'ready';
        session.public.error = undefined;
        session.public.progress = stale;
        throw new ApiError(409, 'stale_plan', stale);
      }

      session.public.status = 'repairing';
      session.public.error = undefined;
      session.public.progress = `Submitting reviewed DepositPreauth Unauthorize for ${plan.affectedAddress}`;
      const baseline = structuredClone(fresh);
      schedulePersist(persistQueue, metadataDir, session);
      void runRepair(session, plan, baseline).catch((error) => {
        session.uncertainRepair = true;
        session.consumedPlanIds.add(plan.id);
        session.activePlan = null;
        session.public.status = 'error';
        session.public.error = `Repair outcome is uncertain (${redactError(error)}). This plan will not be resubmitted. A fresh test environment is required.`;
        session.public.progress = 'Repair outcome uncertain';
        session.busy = false;
        session.operationId = null;
        schedulePersist(persistQueue, metadataDir, session);
      });
      return { sessionId: id };
    } catch (error) {
      session.busy = false;
      session.operationId = null;
      schedulePersist(persistQueue, metadataDir, session);
      throw error;
    }
  }

  async function runRepair(session: PrivateSession, plan: RepairPlan, baseline: AccountSnapshot): Promise<void> {
    try {
      const port = await resolveLedger();
      let receipt: unknown;
      try {
        receipt = await port.executeStoredRepair(session.ledger, { id: plan.id, affectedAddress: plan.affectedAddress });
      } catch (error) {
        session.uncertainRepair = true;
        session.consumedPlanIds.add(plan.id);
        session.activePlan = null;
        if (isStaleRepairError(error)) {
          session.public.status = 'error';
          session.public.error = `Repair was not submitted again after a ledger rejection (${redactError(error)}). This plan will not be resubmitted. Rerun checks.`;
          session.public.progress = 'Repair failed';
          return;
        }
        session.public.status = 'error';
        session.public.error = `Repair outcome is uncertain (${redactError(error)}). This plan will not be resubmitted. A fresh test environment is required.`;
        session.public.progress = 'Repair outcome uncertain';
        return;
      }

      const accepted = asSuccessReceipt(receipt);
      session.consumedPlanIds.add(plan.id);
      session.activePlan = null;
      if (!accepted) {
        session.uncertainRepair = true;
        session.public.status = 'error';
        session.public.error = `Repair was not a validated tesSUCCESS (${describeRejectedReceipt(receipt)}). This plan will not be resubmitted.`;
        session.public.progress = 'Repair rejected';
        return;
      }

      session.public.repairReceipt = accepted;
      try {
        const after = await port.readSnapshot(session.ledger);
        session.public.snapshot = structuredClone(after);
        session.public.network = after.network;
        const problem = verifyRepairEffect(baseline, after, plan.affectedAddress);
        if (problem) {
          session.public.status = 'error';
          session.public.error = `Repair receipt is validated, but follow-up state is uncertain (${problem}). The receipt was kept and the plan will not be resubmitted.`;
          session.public.progress = 'Repair verification uncertain';
          return;
        }
        session.public.error = undefined;
        session.public.status = 'ready';
        session.public.progress = `Repair validated for ${plan.affectedAddress}.`;
      } catch (error) {
        session.public.status = 'error';
        session.public.error = `Repair receipt is validated, but the follow-up ledger read failed (${redactError(error)}). Verification is uncertain. The receipt was kept and the plan will not be resubmitted.`;
        session.public.progress = 'Repair verification uncertain';
      }
    } finally {
      session.busy = false;
      session.operationId = null;
      schedulePersist(persistQueue, metadataDir, session);
    }
  }

  return { createSession, getSession, startChecks, startRepair };
}
