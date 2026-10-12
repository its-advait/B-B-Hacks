import { useEffect, useRef, useState } from 'react';
import type { PublicSession, SessionStatus } from '../shared/contracts';
import { Dashboard } from './Dashboard';
import { buildFixtureSession, type FixtureScenario } from './fixtures';
import {
  SessionApiError,
  createTestSession,
  getSession,
  isBusyStatus,
  startAfterChecks,
  startBeforeChecks,
  submitRepair,
} from './sessionApi';

const SESSION_KEY = 'gatecheck.sessionId';

type HealthState =
  | { status: 'loading' }
  | { status: 'success'; body: string }
  | { status: 'error'; message: string };

const missingSessionMessage =
  'This session is missing. The server may have restarted. Check the approval box and click Create test environment when you want a new one.';

export function App() {
  const [health, setHealth] = useState<HealthState>({ status: 'loading' });
  const [fixtureOn, setFixtureOn] = useState(false);
  const [scenario, setScenario] = useState<FixtureScenario>('before');
  const [liveSession, setLiveSession] = useState<PublicSession | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [setupPending, setSetupPending] = useState(false);
  const [checksPending, setChecksPending] = useState(false);
  const [repairPending, setRepairPending] = useState(false);
  const [stalePlanId, setStalePlanId] = useState<string | null>(null);
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const mutationLock = useRef(false);
  const showFixtureSwitch = import.meta.env.DEV;
  const fixtureActive = showFixtureSwitch && fixtureOn;
  const session = fixtureActive ? buildFixtureSession(scenario) : liveSession;

  useEffect(() => {
    const controller = new AbortController();

    fetch('/api/health', { signal: controller.signal })
      .then(async (response) => {
        const text = await response.text();
        if (!response.ok) {
          throw new Error(text || `HTTP ${response.status}`);
        }
        let body = text;
        try {
          body = JSON.stringify(JSON.parse(text));
        } catch {
          throw new Error('Health response was not JSON');
        }
        setHealth({ status: 'success', body });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Health request failed';
        setHealth({ status: 'error', message });
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('session')?.trim() ?? '';
    const stored = requested.length > 0 ? requested : sessionStorage.getItem(SESSION_KEY);
    if (!stored) {
      return;
    }
    const controller = new AbortController();
    void getSession(stored, controller.signal)
      .then((loaded) => {
        if (!controller.signal.aborted) {
          sessionStorage.setItem(SESSION_KEY, loaded.id);
          setSessionUnavailable(false);
          setLiveSession(loaded);
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          return;
        }
        if (error instanceof SessionApiError && error.status === 404) {
          sessionStorage.removeItem(SESSION_KEY);
          setLiveSession(null);
          setSessionNotice(missingSessionMessage);
          return;
        }
        setSessionNotice(error instanceof Error ? error.message : 'Could not load the saved session.');
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const id = liveSession?.id;
    const status = liveSession?.status;
    if (!id || !isBusyStatus(status)) {
      return;
    }
    let cancelled = false;
    const timer = window.setInterval(() => {
      void getSession(id)
        .then((next) => {
          if (cancelled) {
            return;
          }
          setLiveSession(next);
          setSessionNotice(null);
        })
        .catch((error: unknown) => {
          if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) {
            return;
          }
          if (error instanceof SessionApiError && error.status === 404) {
            sessionStorage.removeItem(SESSION_KEY);
            setLiveSession(null);
            setSessionNotice(missingSessionMessage);
            return;
          }
          setSessionNotice(error instanceof Error ? error.message : 'Could not refresh the session.');
        });
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [liveSession?.id, liveSession?.status]);

  function claimMutation(): boolean {
    if (mutationLock.current) {
      return false;
    }
    mutationLock.current = true;
    return true;
  }

  function releaseMutation() {
    mutationLock.current = false;
  }

  function keepEvidenceOnLoss(error: unknown): boolean {
    if (!(error instanceof SessionApiError) || error.status !== 404) {
      return false;
    }
    sessionStorage.removeItem(SESSION_KEY);
    setSessionUnavailable(true);
    setSessionNotice(`${missingSessionMessage} Results already on this page stay until you refresh or create a new environment.`);
    return true;
  }

  async function adoptAccepted(sessionId: string, busyStatus: SessionStatus) {
    try {
      setLiveSession(await getSession(sessionId));
    } catch (error: unknown) {
      if (keepEvidenceOnLoss(error)) {
        return;
      }
      setLiveSession((previous) => (previous && previous.id === sessionId ? { ...previous, status: busyStatus } : previous));
      setSessionNotice(
        error instanceof Error
          ? `${error.message} The request was accepted and this page will keep asking for the session.`
          : 'The request was accepted, but the session could not be refreshed. This page will keep asking for the session.',
      );
    }
  }

  function createEnvironment() {
    if (!claimMutation()) {
      return;
    }
    if (fixtureActive || setupPending || checksPending || repairPending || isBusyStatus(liveSession?.status)) {
      releaseMutation();
      return;
    }
    setSetupPending(true);
    setSessionNotice(null);
    void createTestSession()
      .then(async ({ sessionId }) => {
        sessionStorage.setItem(SESSION_KEY, sessionId);
        setSessionUnavailable(false);
        setStalePlanId(null);
        setLiveSession(await getSession(sessionId));
      })
      .catch((error: unknown) => {
        setSessionNotice(error instanceof Error ? error.message : 'Could not create a test environment.');
      })
      .finally(() => {
        setSetupPending(false);
        releaseMutation();
      });
  }

  function runBeforeChecks() {
    const current = liveSession;
    if (!claimMutation()) {
      return;
    }
    if (
      fixtureActive ||
      sessionUnavailable ||
      setupPending ||
      checksPending ||
      repairPending ||
      isBusyStatus(current?.status) ||
      current?.status !== 'ready' ||
      !current.snapshot
    ) {
      releaseMutation();
      return;
    }
    const sessionId = current.id;
    setChecksPending(true);
    setSessionNotice(null);
    void startBeforeChecks(sessionId)
      .then((accepted) => adoptAccepted(accepted.sessionId, 'checking'))
      .catch((error: unknown) => {
        if (!keepEvidenceOnLoss(error)) {
          setSessionNotice(error instanceof Error ? error.message : 'Could not start before checks. The request was not repeated.');
        }
      })
      .finally(() => {
        setChecksPending(false);
        releaseMutation();
      });
  }

  function runAfterChecks() {
    const current = liveSession;
    if (!claimMutation()) {
      return;
    }
    const receipt = current?.repairReceipt;
    if (
      fixtureActive ||
      sessionUnavailable ||
      setupPending ||
      checksPending ||
      repairPending ||
      isBusyStatus(current?.status) ||
      current?.status !== 'ready' ||
      receipt?.validated !== true ||
      receipt.resultCode !== 'tesSUCCESS'
    ) {
      releaseMutation();
      return;
    }
    const sessionId = current.id;
    setChecksPending(true);
    setSessionNotice(null);
    void startAfterChecks(sessionId)
      .then((accepted) => adoptAccepted(accepted.sessionId, 'checking'))
      .catch((error: unknown) => {
        if (!keepEvidenceOnLoss(error)) {
          setSessionNotice(error instanceof Error ? error.message : 'Could not start after checks. The request was not repeated.');
        }
      })
      .finally(() => {
        setChecksPending(false);
        releaseMutation();
      });
  }

  function approveRepair(planId: string) {
    const current = liveSession;
    if (!claimMutation()) {
      return;
    }
    const receipt = current?.repairReceipt;
    if (
      fixtureActive ||
      sessionUnavailable ||
      setupPending ||
      checksPending ||
      repairPending ||
      stalePlanId === planId ||
      isBusyStatus(current?.status) ||
      current?.status !== 'ready' ||
      (receipt?.validated === true && receipt.resultCode === 'tesSUCCESS')
    ) {
      releaseMutation();
      return;
    }
    const sessionId = current.id;
    setRepairPending(true);
    setSessionNotice(null);
    void submitRepair(sessionId, planId)
      .then((accepted) => adoptAccepted(accepted.sessionId, 'repairing'))
      .catch((error: unknown) => {
        if (keepEvidenceOnLoss(error)) {
          return;
        }
        if (error instanceof SessionApiError && error.code === 'stale_plan') {
          setStalePlanId(planId);
          setSessionNotice(`${error.message} Do not approve a replacement unless you explicitly rerun before checks.`);
          void getSession(sessionId)
            .then((next) => setLiveSession(next))
            .catch(() => undefined);
          return;
        }
        setSessionNotice(error instanceof Error ? error.message : 'Could not submit the repair. The request was not repeated.');
      })
      .finally(() => {
        setRepairPending(false);
        releaseMutation();
      });
  }

  return (
    <Dashboard
      health={health}
      showFixtureSwitch={showFixtureSwitch}
      fixtureOn={fixtureActive}
      scenario={scenario}
      onFixtureOnChange={setFixtureOn}
      onScenarioChange={setScenario}
      session={session}
      sessionNotice={fixtureActive ? null : sessionNotice}
      setupPending={setupPending}
      checksPending={checksPending}
      repairPending={repairPending}
      stalePlanId={stalePlanId}
      sessionUnavailable={sessionUnavailable}
      onCreateEnvironment={createEnvironment}
      onRunBeforeChecks={runBeforeChecks}
      onRunAfterChecks={runAfterChecks}
      onSubmitRepair={approveRepair}
    />
  );
}
