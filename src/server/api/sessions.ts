import { randomUUID } from 'node:crypto';
import type { IntendedPolicy, Phase, PublicSession, RepairPlan } from '../../shared/contracts.js';
import { ApiError } from './errors.js';
import type { LedgerPort } from './ledgerPort.js';
import { redactError, redactSecrets } from './redact.js';
import { deriveIntendedPolicy } from '../policy/evaluate.js';
import { isStaleRepairError } from './ledgerMap.js';
import { buildReport, CHECK_ACTORS } from '../policy/report.js';

interface PrivateSession {
  public: PublicSession;
  ledger: unknown;
  policy: IntendedPolicy | null;
  busy: boolean;
  activePlan: RepairPlan | null;
  consumedPlanIds: Set<string>;
}

export interface SessionService {
  createSession(body: unknown): { sessionId: string };
  getSession(id: string): PublicSession;
  startChecks(id: string, body: unknown): { sessionId: string };
  startRepair(id: string, body: unknown): Promise<{ sessionId: string }>;
}

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

export function createSessionService(resolveLedger: () => Promise<LedgerPort>): SessionService {
  const sessions = new Map<string, PrivateSession>();

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
    };
    sessions.set(id, session);
    void runSetup(session);
    return { sessionId: id };
  }

  async function runSetup(session: PrivateSession): Promise<void> {
    try {
      const port = await resolveLedger();
      session.ledger = await port.createDemoEnvironment((message) => {
        session.public.progress = redactSecrets(message);
      });
      const snapshot = await port.readSnapshot(session.ledger);
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
    session.public.status = 'checking';
    session.public.error = undefined;
    session.public.progress = phase === 'before' ? 'Starting before checks' : 'Starting after checks';
    void runChecks(session, phase);
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
      const snapshot = await port.readSnapshot(session.ledger);
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

      let report = buildReport({ phase, snapshot, policy, observations });
      if (report.repairPlan) {
        const affectedAddress = report.repairPlan.affectedAddress;
        session.public.progress = `Storing repair preview for ${affectedAddress}`;
        try {
          const stored = await port.previewDirectApprovalRepair(session.ledger, affectedAddress);
          report = { ...report, repairPlan: stored };
        } catch (error) {
          report = buildReport({ phase, snapshot, policy, observations, includeRepair: false });
          session.public.progress = `Repair preview was not stored: ${redactError(error)}`;
        }
      }
      session.public.snapshot = structuredClone(snapshot);
      session.public.network = snapshot.network;
      session.public.reports = [...session.public.reports, report];
      session.activePlan = report.repairPlan ?? null;
      session.public.error = undefined;
      session.public.status = 'ready';
      session.public.progress = report.repairPlan
        ? 'Checks complete. A repair plan is waiting for review.'
        : 'Checks complete.';
    } catch (error) {
      session.public.status = 'error';
      session.public.error = redactError(error);
      session.public.progress = 'Checks failed';
    } finally {
      session.busy = false;
    }
  }

  async function startRepair(id: string, body: unknown): Promise<{ sessionId: string }> {
    const session = requireSession(sessions, id);
    if (!isRecord(body)) {
      throw new ApiError(400, 'invalid_body', 'Repair body must be a JSON object.');
    }
    if (body.approved !== true) {
      throw new ApiError(400, 'approval_required', 'approved must be true before the reviewed repair is submitted.');
    }
    if (typeof body.planId !== 'string' || body.planId.length === 0) {
      throw new ApiError(400, 'invalid_body', 'planId must be the id of a stored repair plan.');
    }

    assertIdle(session);
    if (!session.ledger || !session.policy) {
      throw new ApiError(409, 'invalid_phase', 'The test environment is not ready.');
    }
    if (session.consumedPlanIds.has(body.planId) || session.activePlan?.id !== body.planId) {
      throw new ApiError(409, 'stale_plan', 'Unknown or outdated repair plan. Rerun checks.');
    }

    const plan = session.activePlan;
    session.busy = true;
    session.public.status = 'repairing';
    session.public.error = undefined;
    session.public.progress = `Submitting reviewed DepositPreauth Unauthorize for ${plan.affectedAddress}`;
    try {
      const port = await resolveLedger();
      const receipt = await port.executeStoredRepair(session.ledger, plan.id);
      session.consumedPlanIds.add(plan.id);
      session.activePlan = null;
      session.public.repairReceipt = receipt;
      try {
        const after = await port.readSnapshot(session.ledger);
        session.public.snapshot = structuredClone(after);
        session.public.network = after.network;
      } catch (error) {
        session.public.status = 'ready';
        session.public.error = undefined;
        session.public.progress = `Repair validated. Snapshot refresh failed: ${redactError(error)}`;
        return { sessionId: id };
      }
      session.public.error = undefined;
      session.public.status = 'ready';
      session.public.progress = `Repair validated for ${plan.affectedAddress}.`;
      return { sessionId: id };
    } catch (error) {
      session.consumedPlanIds.add(plan.id);
      session.activePlan = null;
      if (isStaleRepairError(error)) {
        session.public.status = 'ready';
        session.public.error = undefined;
        session.public.progress = redactError(error);
        throw new ApiError(409, 'stale_plan', redactError(error));
      }
      session.public.status = 'error';
      session.public.error = `Repair outcome is unknown or failed (${redactError(error)}). This plan will not be resubmitted. Rerun checks.`;
      session.public.progress = 'Repair failed';
      return { sessionId: id };
    } finally {
      session.busy = false;
    }
  }

  return { createSession, getSession, startChecks, startRepair };
}
