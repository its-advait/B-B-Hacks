import type { CheckRow, PublicSession, Report } from '../../shared/contracts.js';

/**
 * Exercises a local GateCheck API that is already running.
 * It creates testnet accounts only when --run-real-testnet is present.
 *
 *   npx tsx src/server/api/smoke.ts --run-real-testnet
 *
 * GATECHECK_API_URL defaults to http://127.0.0.1:3001.
 * GATECHECK_SMOKE_DEADLINE_MS defaults to 180000.
 */

const base = process.env.GATECHECK_API_URL ?? 'http://127.0.0.1:3001';
const deadlineMs = Number(process.env.GATECHECK_SMOKE_DEADLINE_MS ?? 180_000);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!process.argv.includes('--run-real-testnet')) {
  fail('Refusing to create accounts or send payments. Re-run with --run-real-testnet against an already-running local server.');
}

async function call(method: string, route: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as unknown : null };
}

function sessionFrom(body: unknown): PublicSession {
  return body as PublicSession;
}

async function pollSession(id: string, ready: (session: PublicSession) => boolean): Promise<PublicSession> {
  const deadline = Date.now() + deadlineMs;
  let lastProgress = '';
  let last: PublicSession | undefined;
  while (Date.now() < deadline) {
    const response = await call('GET', `/api/sessions/${id}`);
    if (response.status !== 200) {
      fail(`GET /api/sessions/${id} returned ${response.status}: ${JSON.stringify(response.body)}`);
    }
    last = sessionFrom(response.body);
    if (last.progress !== lastProgress) {
      console.log(`progress: ${last.progress}`);
      lastProgress = last.progress;
    }
    if (last.status === 'error') {
      fail(`Session ${id} failed: ${last.error ?? 'unknown error'}`);
    }
    if (ready(last)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  fail(`Timed out waiting for session ${id}. Last status ${last?.status ?? 'none'}.`);
}

function printRows(report: Report): void {
  for (const row of report.rows) {
    console.log(`${row.actor} expected=${row.expected} observed=${row.observed} verdict=${row.verdict} hash=${row.transactionHash ?? ''} resultCode=${row.resultCode ?? ''}`);
  }
}

function row(report: Report, actor: CheckRow['actor']): CheckRow {
  const found = report.rows.find((item) => item.actor === actor);
  if (!found) {
    fail(`Report ${report.id} is missing ${actor}.`);
  }
  return found;
}

function assertOutcome(report: Report, actor: CheckRow['actor'], expected: 'allowed' | 'blocked', observed: 'allowed' | 'blocked', verdict: CheckRow['verdict']): void {
  const found = row(report, actor);
  if (found.observed === 'inconclusive' || found.verdict === 'inconclusive') {
    fail(`${report.phase} ${actor} is inconclusive and is not a blocked payment. ${found.explanation}`);
  }
  if (found.expected !== expected || found.observed !== observed || found.verdict !== verdict) {
    fail(`${report.phase} ${actor} was expected=${found.expected} observed=${found.observed} verdict=${found.verdict}; wanted ${expected}/${observed}/${verdict}.`);
  }
}

const health = await call('GET', '/api/health');
if (health.status !== 200) {
  fail(`Health returned ${health.status}.`);
}
console.log(`health: ${JSON.stringify(health.body)}`);

const missingApproval = await call('POST', '/api/sessions', {});
if (missingApproval.status !== 400) {
  fail(`Missing setup approval returned ${missingApproval.status}, not 400.`);
}

const created = await call('POST', '/api/sessions', { approveTestnetSetup: true });
if (created.status !== 202) {
  fail(`Session create returned ${created.status}: ${JSON.stringify(created.body)}`);
}
const sessionId = String((created.body as { sessionId?: string }).sessionId ?? '');
if (!sessionId) {
  fail('Session create did not return a sessionId.');
}
console.log(`session: ${sessionId}`);

const ready = await pollSession(sessionId, (session) => session.status === 'ready' && session.snapshot !== undefined);
console.log(`snapshot: network=${ready.snapshot?.network} depositAuth=${String(ready.snapshot?.depositAuthEnabled)} trustedRule=${String(ready.snapshot?.trustedCredentialRulePresent)}`);

const checksWithoutApproval = await call('POST', `/api/sessions/${sessionId}/checks`, { phase: 'before' });
if (checksWithoutApproval.status !== 400) {
  fail(`Missing payment approval returned ${checksWithoutApproval.status}, not 400.`);
}

const beforeIds = new Set(ready.reports.map((report) => report.id));
const started = await call('POST', `/api/sessions/${sessionId}/checks`, { phase: 'before', approveTestPayments: true });
if (started.status !== 202) {
  fail(`Before checks returned ${started.status}: ${JSON.stringify(started.body)}`);
}
const overlap = await call('POST', `/api/sessions/${sessionId}/checks`, { phase: 'before', approveTestPayments: true });
if (overlap.status !== 409) {
  fail(`Overlapping checks returned ${overlap.status}, not 409.`);
}

const beforeSession = await pollSession(sessionId, (session) => {
  return session.status === 'ready' && session.reports.some((report) => report.phase === 'before' && !beforeIds.has(report.id));
});
const beforeReport = beforeSession.reports.find((report) => report.phase === 'before' && !beforeIds.has(report.id));
if (!beforeReport) {
  fail('No new before report was stored.');
}
console.log(`before report: ${beforeReport.id}`);
printRows(beforeReport);
const plan = beforeReport.repairPlan;
if (!plan) {
  fail('No evidence-supported repair plan was returned. Stopping without fabricating one.');
}
console.log(`repair plan: ${plan.id} address=${plan.affectedAddress}`);

const repairWithoutApproval = await call('POST', `/api/sessions/${sessionId}/repair`, { planId: plan.id, approved: false });
if (repairWithoutApproval.status !== 400) {
  fail(`Missing repair approval returned ${repairWithoutApproval.status}, not 400.`);
}

const repairStarted = await call('POST', `/api/sessions/${sessionId}/repair`, { planId: plan.id, approved: true });
if (repairStarted.status !== 202) {
  fail(`Repair returned ${repairStarted.status}: ${JSON.stringify(repairStarted.body)}`);
}
const repaired = await pollSession(sessionId, (session) => session.repairReceipt?.validated === true && session.status === 'ready');
console.log(`repair receipt: hash=${repaired.repairReceipt?.transactionHash ?? ''} resultCode=${repaired.repairReceipt?.resultCode ?? ''}`);

const reuse = await call('POST', `/api/sessions/${sessionId}/repair`, { planId: plan.id, approved: true });
if (reuse.status !== 409) {
  fail(`Repair re-use returned ${reuse.status}, not 409.`);
}

const afterIds = new Set(repaired.reports.map((report) => report.id));
const afterStarted = await call('POST', `/api/sessions/${sessionId}/checks`, { phase: 'after', approveTestPayments: true });
if (afterStarted.status !== 202) {
  fail(`After checks returned ${afterStarted.status}: ${JSON.stringify(afterStarted.body)}`);
}
const afterSession = await pollSession(sessionId, (session) => {
  return session.status === 'ready' && session.reports.some((report) => report.phase === 'after' && !afterIds.has(report.id));
});
const afterReport = afterSession.reports.find((report) => report.phase === 'after' && !afterIds.has(report.id));
if (!afterReport) {
  fail('No new after report was stored.');
}
console.log(`after report: ${afterReport.id}`);
printRows(afterReport);

assertOutcome(beforeReport, 'validCustomer', 'allowed', 'allowed', 'match');
assertOutcome(beforeReport, 'legacyCustomer', 'allowed', 'allowed', 'mismatch');
assertOutcome(beforeReport, 'stranger', 'blocked', 'blocked', 'match');
assertOutcome(afterReport, 'validCustomer', 'allowed', 'allowed', 'match');
assertOutcome(afterReport, 'legacyCustomer', 'blocked', 'blocked', 'match');
assertOutcome(afterReport, 'stranger', 'blocked', 'blocked', 'match');

const storedBefore = repaired.reports.find((report) => report.id === beforeReport.id);
if (!storedBefore || storedBefore.rows[1]?.observed !== 'allowed' || storedBefore.rows[1]?.resultCode !== beforeReport.rows[1]?.resultCode) {
  fail('The stored before report changed after repair.');
}

console.log('Smoke summary: before and after reports matched the seeded demo. Repair receipt is separate from the after report.');
