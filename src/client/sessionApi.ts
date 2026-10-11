import type { PublicSession, SessionStatus } from '../shared/contracts';

const BUSY: ReadonlySet<SessionStatus> = new Set(['settingUp', 'checking', 'repairing']);

export class SessionApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'SessionApiError';
    this.status = status;
    this.code = code;
  }
}

export function isBusyStatus(status: SessionStatus | undefined): boolean {
  return status !== undefined && BUSY.has(status);
}

export async function createTestSession(): Promise<{ sessionId: string }> {
  let response: Response;
  try {
    response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approveTestnetSetup: true }),
    });
  } catch {
    throw new SessionApiError(0, 'network', 'Could not reach the session API. Start the server, then try again.');
  }
  const body = await readBody(response);
  if (!response.ok) {
    throw errorFromResponse(response.status, body);
  }
  if (!isRecord(body) || typeof body.sessionId !== 'string' || body.sessionId.length === 0) {
    throw new SessionApiError(response.status, 'invalid_response', 'The session API did not return a session id.');
  }
  return { sessionId: body.sessionId };
}

export function startBeforeChecks(id: string): Promise<{ sessionId: string }> {
  return startChecks(id, 'before');
}

export function startAfterChecks(id: string): Promise<{ sessionId: string }> {
  return startChecks(id, 'after');
}

export async function submitRepair(id: string, planId: string): Promise<{ sessionId: string }> {
  return postSession(id, '/repair', { planId, approved: true }, 'The repair request was not repeated.');
}

async function startChecks(id: string, phase: 'before' | 'after'): Promise<{ sessionId: string }> {
  return postSession(id, '/checks', { phase, approveTestPayments: true }, 'The check request was not repeated.');
}

async function postSession(
  id: string,
  path: '/checks' | '/repair',
  body: Record<string, unknown>,
  notRepeated: string,
): Promise<{ sessionId: string }> {
  let response: Response;
  try {
    response = await fetch(`/api/sessions/${encodeURIComponent(id)}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SessionApiError(0, 'network', `Could not reach the session API. Start the server, then try again. ${notRepeated}`);
  }
  const payload = await readBody(response);
  if (!response.ok) {
    throw errorFromResponse(response.status, payload);
  }
  if (!isRecord(payload) || typeof payload.sessionId !== 'string' || payload.sessionId.length === 0) {
    throw new SessionApiError(response.status, 'invalid_response', 'The session API accepted the request but did not return a session id.');
  }
  return { sessionId: payload.sessionId };
}

export async function getSession(id: string, signal?: AbortSignal): Promise<PublicSession> {
  let response: Response;
  try {
    response = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new SessionApiError(0, 'network', 'Could not reach the session API. Start the server, then try again.');
  }
  const body = await readBody(response);
  if (!response.ok) {
    throw errorFromResponse(response.status, body);
  }
  if (!isSession(body)) {
    throw new SessionApiError(response.status, 'invalid_response', 'The session API returned an unexpected session.');
  }
  return body;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function errorFromResponse(status: number, body: unknown): SessionApiError {
  const record = isRecord(body) && isRecord(body.error) ? body.error : null;
  const code = typeof record?.code === 'string' ? record.code : 'http_error';
  const serverMessage = typeof record?.message === 'string' ? record.message : `The session API returned HTTP ${status}.`;
  return new SessionApiError(status, code, `${serverMessage} ${hintForError(status, code, serverMessage)}`);
}

function hintForError(status: number, code: string, serverMessage: string): string {
  if (code === 'approval_required') {
    if (serverMessage.includes('approveTestPayments')) {
      return 'Check the test-payment approval box, then click the check action again. The request was not repeated.';
    }
    if (serverMessage.includes('approved must be true')) {
      return 'Check the repair approval box, then click Approve repair again. The repair was not repeated.';
    }
    return 'Check the setup approval box, then click Create test environment again.';
  }
  if (status === 404 || code === 'session_not_found') {
    return 'This session is missing. The server may have restarted. Create a new test environment when you are ready. Nothing was submitted again.';
  }
  if (code === 'job_in_progress') {
    return 'Another job is already running. This request was not repeated.';
  }
  if (code === 'stale_plan') {
    return 'This plan is stale. Rerun before checks for a new plan. This repair was not submitted again.';
  }
  if (code === 'invalid_phase') {
    return 'That action does not match the current session stage. It was not repeated.';
  }
  if (status === 409) {
    return 'The server rejected this request because of a conflict. It was not repeated.';
  }
  if (status >= 500) {
    return 'The server failed. The last session on this page was kept. You can try again after it recovers.';
  }
  return 'Check that the API is running, then try again. Nothing was submitted again.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSession(value: unknown): value is PublicSession {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.id === 'string' && typeof value.status === 'string' && typeof value.progress === 'string' && Array.isArray(value.reports);
}
