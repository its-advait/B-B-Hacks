import { useEffect, useState } from 'react';

type HealthState =
  | { status: 'loading' }
  | { status: 'success'; body: string }
  | { status: 'error'; message: string };

export function App() {
  const [health, setHealth] = useState<HealthState>({ status: 'loading' });

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
    <main>
      <h1>GateCheck — Testnet</h1>
      {health.status === 'loading' ? <p role="status">Checking API health…</p> : null}
      {health.status === 'success' ? (
        <p role="status">API health check succeeded: {health.body}</p>
      ) : null}
      {health.status === 'error' ? (
        <p role="alert">API health check failed: {health.message}</p>
      ) : null}
    </main>
  );
}
