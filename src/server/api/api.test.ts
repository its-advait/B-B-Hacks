import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import test from 'node:test';
import type { AccountSnapshot, ActorRole, PaymentObservation, PublicSession, RepairPlan } from '../../shared/contracts.js';
import { deriveIntendedPolicy } from '../policy/evaluate.js';
import { authorizationFingerprint } from '../policy/fingerprint.js';
import { createApp } from './createApp.js';
import { loadLedgerPort } from './ledgerAdapter.js';
import { LedgerUnavailableError, type LedgerPort } from './ledgerPort.js';
import { redactSecrets } from './redact.js';

/**
 * Development fixture for API unit tests only.
 * The server entrypoint never uses this adapter, and it does not claim live XRPL results.
 */
class ScriptedLedger implements LedgerPort {
  removed: string[] = [];
  paymentOrder: ActorRole[] = [];
  failRepair = false;
  repairCalls = 0;
  private plans = new Map<string, { address: string; consumed: boolean }>();
  private gate: Promise<void> | null = null;
  private releaseGate: (() => void) | null = null;

  constructor(public snapshot: AccountSnapshot, public payments: Record<ActorRole, PaymentObservation>) {}

  holdSetup(): void {
    this.gate = new Promise((resolve) => {
      this.releaseGate = resolve;
    });
  }

  releaseSetup(): void {
    this.releaseGate?.();
    this.gate = null;
  }

  async createDemoEnvironment(onProgress: (message: string) => void): Promise<unknown> {
    onProgress('Development fixture: creating environment seed sEdVL7h30dK1mN2pQ3rS');
    if (this.gate) {
      await this.gate;
    }
    return { seed: 'sEdVL7h30dK1mN2pQ3rS', label: 'development-fixture' };
  }

  async readSnapshot(): Promise<AccountSnapshot> {
    return structuredClone(this.snapshot);
  }

  async sendTestPayment(_session: unknown, actor: ActorRole): Promise<PaymentObservation> {
    this.paymentOrder.push(actor);
    const payment = this.payments[actor];
    return structuredClone(payment);
  }

  async previewDirectApprovalRepair(_session: unknown, address: string): Promise<RepairPlan> {
    const actor = this.snapshot.actors.find((item) => item.address === address);
    if (!this.snapshot.depositAuthEnabled || !actor?.individuallyApproved) {
      throw new Error('No direct wallet approval to remove');
    }
    const id = randomUUID();
    this.plans.set(id, { address, consumed: false });
    return {
      id,
      description: 'Testnet configuration change: stored ledger preview',
      affectedAddress: address,
      unsignedTransaction: {
        TransactionType: 'DepositPreauth',
        Account: this.snapshot.treasuryAddress,
        Unauthorize: address,
      },
      snapshotFingerprint: authorizationFingerprint(this.snapshot, deriveIntendedPolicy(this.snapshot)),
    };
  }

  async executeStoredRepair(_session: unknown, plan: { id: string; affectedAddress: string }): Promise<{
    transactionHash: string;
    resultCode: string;
    validated: true;
  }> {
    const stored = this.plans.get(plan.id);
    if (!stored) {
      throw new Error('Invalid plan ID');
    }
    if (stored.consumed) {
      throw new Error('Plan already submitted; reconcile its journal receipt, do not reapply');
    }
    const actor = this.snapshot.actors.find((item) => item.address === stored.address);
    if (!this.snapshot.depositAuthEnabled || !actor?.individuallyApproved) {
      throw new Error('Authorization state changed; preview and approve a fresh plan');
    }
    this.repairCalls += 1;
    stored.consumed = true;
    if (this.failRepair) {
      throw new Error('socket timeout after submission seed sEdVL7h30dK1mN2pQ3rS');
    }
    this.removed.push(stored.address);
    actor.individuallyApproved = false;
    this.payments.legacyCustomer = {
      actor: 'legacyCustomer',
      observed: 'blocked',
      validated: true,
      transactionHash: 'HASH_legacy_after',
      resultCode: 'tecNO_PERMISSION',
    };
    return { transactionHash: 'REPAIR_HASH', resultCode: 'tesSUCCESS', validated: true };
  }
}

function demoSnapshot(): AccountSnapshot {
  return {
    network: 'devnet',
    ledgerIndex: 40,
    treasuryAddress: 'rTreasury',
    issuerAddress: 'rIssuer',
    credentialType: 'customer',
    depositAuthEnabled: true,
    trustedCredentialRulePresent: true,
    capturedAt: '2026-01-01T00:00:00.000Z',
    actors: [
      { role: 'validCustomer', address: 'rValid', credentialStatus: 'valid', individuallyApproved: false },
      { role: 'legacyCustomer', address: 'rLegacy', credentialStatus: 'revoked', individuallyApproved: true },
      { role: 'stranger', address: 'rStranger', credentialStatus: 'none', individuallyApproved: false },
    ],
  };
}

function demoPayments(): Record<ActorRole, PaymentObservation> {
  return {
    validCustomer: {
      actor: 'validCustomer',
      observed: 'allowed',
      validated: true,
      transactionHash: 'HASH_valid',
      resultCode: 'tesSUCCESS',
    },
    legacyCustomer: {
      actor: 'legacyCustomer',
      observed: 'allowed',
      validated: true,
      transactionHash: 'HASH_legacy',
      resultCode: 'tesSUCCESS',
    },
    stranger: {
      actor: 'stranger',
      observed: 'blocked',
      validated: true,
      transactionHash: 'HASH_stranger',
      resultCode: 'tecNO_PERMISSION',
    },
  };
}

async function withServer(port: LedgerPort, run: (base: string) => Promise<void>): Promise<void> {
  const app = createApp({ resolveLedger: async () => port });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test server did not bind a port');
  }
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await closeServer(server);
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function request(base: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as unknown : null };
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, 'object');
  assert.ok(value);
  return value as Record<string, unknown>;
}

async function poll(base: string, id: string, ready: (session: PublicSession) => boolean): Promise<PublicSession> {
  const deadline = Date.now() + 3000;
  let last: PublicSession | undefined;
  while (Date.now() < deadline) {
    const response = await request(base, 'GET', `/api/sessions/${id}`);
    last = response.body as PublicSession;
    if (ready(last)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for session ${id}: ${JSON.stringify(last)}`);
}

test('redactSecrets hides seed material', () => {
  const redacted = redactSecrets('seed sEdVL7h30dK1mN2pQ3rS and secret=abc');
  assert.equal(redacted.includes('sEdVL7h30dK1mN2pQ3rS'), false);
  assert.equal(redacted.includes('abc'), false);
});

test('missing approval, unknown session, and unavailable ledger do not fake a job', async () => {
  const ledger = new ScriptedLedger(demoSnapshot(), demoPayments());
  await withServer(ledger, async (base) => {
    const health = await request(base, 'GET', '/api/health');
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { ok: true, mode: 'testnet' });

    const missing = await request(base, 'POST', '/api/sessions', {});
    assert.equal(missing.status, 400);
    assert.equal(asRecord(asRecord(missing.body).error).code, 'approval_required');
    assert.equal(ledger.paymentOrder.length, 0);

    const unknown = await request(base, 'GET', '/api/sessions/missing');
    assert.equal(unknown.status, 404);
    assert.equal(asRecord(asRecord(unknown.body).error).code, 'session_not_found');

    const unknownRepair = await request(base, 'POST', '/api/sessions/missing/repair', { approved: false });
    assert.equal(unknownRepair.status, 404);
  });

  const unavailable = await loadLedgerPort();
  await assert.rejects(() => unavailable.createDemoEnvironment(() => undefined), LedgerUnavailableError);
  await withServer(unavailable, async (base) => {
    const created = await request(base, 'POST', '/api/sessions', { approveTestnetSetup: true });
    assert.equal(created.status, 202);
    const sessionId = String(asRecord(created.body).sessionId);
    const failed = await poll(base, sessionId, (session) => session.status === 'error');
    assert.match(failed.error ?? '', /not simulated|not available|missing agreed exports/i);
    assert.equal(failed.reports.length, 0);
    assert.equal(JSON.stringify(failed).includes('sEd'), false);
  });
});

test('a busy session rejects overlapping mutations', async () => {
  const ledger = new ScriptedLedger(demoSnapshot(), demoPayments());
  ledger.holdSetup();
  try {
    await withServer(ledger, async (base) => {
      const created = await request(base, 'POST', '/api/sessions', { approveTestnetSetup: true });
      const sessionId = String(asRecord(created.body).sessionId);
      const overlap = await request(base, 'POST', `/api/sessions/${sessionId}/checks`, {
        phase: 'before',
        approveTestPayments: true,
      });
      assert.equal(overlap.status, 409);
      assert.equal(asRecord(asRecord(overlap.body).error).code, 'job_in_progress');
      ledger.releaseSetup();
      const ready = await poll(base, sessionId, (session) => session.status === 'ready');
      assert.equal(ready.network, 'devnet');
      assert.equal(JSON.stringify(ready).includes('sEdVL7h30dK1mN2pQ3rS'), false);
      assert.match(ready.progress, /Test environment ready/);
    });
  } finally {
    ledger.releaseSetup();
  }
});

test('cancel sends no repair, stale plans are rejected, and the reviewed flow keeps the before report', async () => {
  const ledger = new ScriptedLedger(demoSnapshot(), demoPayments());
  await withServer(ledger, async (base) => {
    const created = await request(base, 'POST', '/api/sessions', { approveTestnetSetup: true });
    const sessionId = String(asRecord(created.body).sessionId);
    await poll(base, sessionId, (session) => session.status === 'ready');

    const missingApproval = await request(base, 'POST', `/api/sessions/${sessionId}/checks`, { phase: 'before' });
    assert.equal(missingApproval.status, 400);

    const tooSoon = await request(base, 'POST', `/api/sessions/${sessionId}/checks`, {
      phase: 'after',
      approveTestPayments: true,
    });
    assert.equal(tooSoon.status, 409);
    assert.equal(asRecord(asRecord(tooSoon.body).error).code, 'invalid_phase');

    const started = await request(base, 'POST', `/api/sessions/${sessionId}/checks`, {
      phase: 'before',
      approveTestPayments: true,
    });
    assert.equal(started.status, 202);
    const before = await poll(base, sessionId, (session) => session.reports.length === 1 && session.status === 'ready');
    assert.deepEqual(ledger.paymentOrder, ['validCustomer', 'legacyCustomer', 'stranger']);
    const plan = before.reports[0]?.repairPlan;
    assert.ok(plan);
    assert.equal(before.reports[0]?.rows[1]?.verdict, 'mismatch');
    assert.equal(plan.snapshotFingerprint, authorizationFingerprint(ledger.snapshot, deriveIntendedPolicy(ledger.snapshot)));
    assert.equal(before.reports[0]?.rows[1]?.transactionHash, 'HASH_legacy');

    const canceled = await request(base, 'POST', `/api/sessions/${sessionId}/repair`, {
      planId: plan.id,
      approved: false,
      unsignedTransaction: { TransactionType: 'DepositPreauth', Account: 'rTreasury', Unauthorize: 'rStranger' },
    });
    assert.equal(canceled.status, 400);
    assert.equal(ledger.repairCalls, 0);

    ledger.snapshot.actors[1]!.individuallyApproved = false;
    ledger.snapshot.ledgerIndex = 999;
    const stale = await request(base, 'POST', `/api/sessions/${sessionId}/repair`, { planId: plan.id, approved: true });
    assert.equal(stale.status, 409);
    assert.equal(asRecord(asRecord(stale.body).error).code, 'stale_plan');
    assert.equal(ledger.repairCalls, 0);

    const retryStale = await request(base, 'POST', `/api/sessions/${sessionId}/repair`, { planId: plan.id, approved: true });
    assert.equal(retryStale.status, 409);
    assert.equal(ledger.repairCalls, 0);
  });
});

test('approved repair uses the stored address, then after-checks keep the before evidence', async () => {
  const ledger = new ScriptedLedger(demoSnapshot(), demoPayments());
  await withServer(ledger, async (base) => {
    const created = await request(base, 'POST', '/api/sessions', { approveTestnetSetup: true });
    const sessionId = String(asRecord(created.body).sessionId);
    await poll(base, sessionId, (session) => session.status === 'ready');
    await request(base, 'POST', `/api/sessions/${sessionId}/checks`, { phase: 'before', approveTestPayments: true });
    const before = await poll(base, sessionId, (session) => session.reports.length === 1 && session.status === 'ready');
    const plan = before.reports[0]?.repairPlan;
    assert.ok(plan);

    const repaired = await request(base, 'POST', `/api/sessions/${sessionId}/repair`, {
      planId: plan.id,
      approved: true,
      unsignedTransaction: { Unauthorize: 'rStranger' },
    });
    assert.equal(repaired.status, 202);
    const afterRepair = await poll(base, sessionId, (session) => session.status === 'ready' && session.repairReceipt !== undefined);
    assert.equal(ledger.removed.length, 1);
    assert.equal(ledger.removed[0], 'rLegacy');
    assert.equal(afterRepair.repairReceipt?.transactionHash, 'REPAIR_HASH');
    assert.equal(afterRepair.repairReceipt?.validated, true);
    assert.equal(afterRepair.reports[0]?.rows[1]?.observed, 'allowed');

    const duplicate = await request(base, 'POST', `/api/sessions/${sessionId}/repair`, { planId: plan.id, approved: true });
    assert.equal(duplicate.status, 409);
    assert.equal(ledger.repairCalls, 1);

    await request(base, 'POST', `/api/sessions/${sessionId}/checks`, { phase: 'after', approveTestPayments: true });
    const finished = await poll(base, sessionId, (session) => session.reports.length === 2 && session.status === 'ready');
    assert.equal(finished.reports[0]?.phase, 'before');
    assert.equal(finished.reports[0]?.rows[1]?.resultCode, 'tesSUCCESS');
    assert.equal(finished.reports[1]?.phase, 'after');
    assert.equal(finished.reports[1]?.rows[0]?.verdict, 'match');
    assert.equal(finished.reports[1]?.rows[1]?.verdict, 'match');
    assert.equal(finished.reports[1]?.rows[1]?.observed, 'blocked');
    assert.equal(finished.reports[1]?.rows[1]?.resultCode, 'tecNO_PERMISSION');
    assert.equal(finished.reports[1]?.rows[2]?.verdict, 'match');
    assert.equal(finished.reports[1]?.repairPlan, undefined);
    assert.equal(JSON.stringify(finished).includes('sEd'), false);
  });
});

test('a failed repair is not resubmitted automatically', async () => {
  const ledger = new ScriptedLedger(demoSnapshot(), demoPayments());
  ledger.failRepair = true;
  await withServer(ledger, async (base) => {
    const created = await request(base, 'POST', '/api/sessions', { approveTestnetSetup: true });
    const sessionId = String(asRecord(created.body).sessionId);
    await poll(base, sessionId, (session) => session.status === 'ready');
    await request(base, 'POST', `/api/sessions/${sessionId}/checks`, { phase: 'before', approveTestPayments: true });
    const before = await poll(base, sessionId, (session) => session.reports.length === 1 && session.status === 'ready');
    const planId = before.reports[0]?.repairPlan?.id;
    assert.ok(planId);
    const accepted = await request(base, 'POST', `/api/sessions/${sessionId}/repair`, { planId, approved: true });
    assert.equal(accepted.status, 202);
    const failed = await poll(base, sessionId, (session) => session.status === 'error');
    assert.match(failed.error ?? '', /will not be resubmitted/);
    assert.equal(failed.error?.includes('sEdVL7h30dK1mN2pQ3rS'), false);
    assert.equal(failed.repairReceipt, undefined);
    const again = await request(base, 'POST', `/api/sessions/${sessionId}/repair`, { planId, approved: true });
    assert.equal(again.status, 409);
    assert.equal(ledger.repairCalls, 1);
  });
});
