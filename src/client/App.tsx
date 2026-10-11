import { useEffect, useState } from 'react';
import { Dashboard } from './Dashboard';
import { buildFixtureSession, type FixtureScenario } from './fixtures';

type HealthState =
  | { status: 'loading' }
  | { status: 'success'; body: string }
  | { status: 'error'; message: string };

export function App() {
  const [health, setHealth] = useState<HealthState>({ status: 'loading' });
  const [fixtureOn, setFixtureOn] = useState(false);
  const [scenario, setScenario] = useState<FixtureScenario>('before');
  const showFixtureSwitch = import.meta.env.DEV;
  const session = showFixtureSwitch && fixtureOn ? buildFixtureSession(scenario) : null;

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

  return (
    <Dashboard
      health={health}
      showFixtureSwitch={showFixtureSwitch}
      fixtureOn={showFixtureSwitch && fixtureOn}
      scenario={scenario}
      onFixtureOnChange={setFixtureOn}
      onScenarioChange={setScenario}
      session={session}
    />
  );
}
