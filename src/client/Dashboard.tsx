import { useEffect, useState } from 'react';
import type { ActorRole, Outcome, Phase, PublicSession, Report } from '../shared/contracts';
import type { FixtureScenario } from './fixtures';

type HealthState =
  | { status: 'loading' }
  | { status: 'success'; body: string }
  | { status: 'error'; message: string };

interface DashboardProps {
  health: HealthState;
  showFixtureSwitch: boolean;
  fixtureOn: boolean;
  scenario: FixtureScenario;
  onFixtureOnChange: (on: boolean) => void;
  onScenarioChange: (scenario: FixtureScenario) => void;
  session: PublicSession | null;
  sessionNotice: string | null;
  setupPending: boolean;
  checksPending: boolean;
  repairPending: boolean;
  stalePlanId: string | null;
  sessionUnavailable: boolean;
  onCreateEnvironment: () => void;
  onRunBeforeChecks: () => void;
  onRunAfterChecks: () => void;
  onSubmitRepair: (planId: string) => void;
}

const roleLabels: Record<ActorRole, string> = {
  validCustomer: 'Valid customer',
  legacyCustomer: 'Legacy customer',
  stranger: 'Stranger',
};

const outcomeLabels: Record<Outcome, string> = {
  allowed: 'Allowed',
  blocked: 'Blocked',
  inconclusive: 'Inconclusive',
};

const verdictLabels = {
  match: 'Match',
  mismatch: 'Mismatch',
  inconclusive: 'Inconclusive',
} as const;

const scenarios: { value: FixtureScenario; label: string }[] = [
  { value: 'empty', label: 'Empty' },
  { value: 'loading', label: 'Loading' },
  { value: 'error', label: 'Error' },
  { value: 'before', label: 'Before checks: allowed, blocked, and mismatch' },
  { value: 'inconclusive', label: 'Inconclusive' },
  { value: 'after', label: 'After checks' },
];

function explorerUrl(network: string, hash: string): string | null {
  if (network === 'testnet') {
    return `https://testnet.xrpl.org/transactions/${hash}`;
  }
  if (network === 'devnet') {
    return `https://devnet.xrpl.org/transactions/${hash}`;
  }
  return null;
}

function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value).catch(() => copyWithSelection(value));
  }
  return copyWithSelection(value);
}

function copyWithSelection(value: string): Promise<void> {
  const area = document.createElement('textarea');
  area.value = value;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  return copied ? Promise.resolve() : Promise.reject(new Error('Copy failed'));
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [message, setMessage] = useState<'Copy' | 'Copied' | 'Copy failed'>('Copy');

  return (
    <button
      type="button"
      className="copy"
      onClick={() => {
        void copyText(value).then(
          () => {
            setMessage('Copied');
            window.setTimeout(() => setMessage('Copy'), 1500);
          },
          () => setMessage('Copy failed'),
        );
      }}
    >
      {message}
      <span className="visually-hidden"> {label}</span>
    </button>
  );
}

function AddressLine({ value, label }: { value: string; label: string }) {
  return (
    <span className="address">
      <code>{value}</code>
      <CopyButton value={value} label={label} />
    </span>
  );
}

function downloadReport(report: Report) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `gatecheck-${report.phase}-${report.id}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Dashboard({
  health,
  showFixtureSwitch,
  fixtureOn,
  scenario,
  onFixtureOnChange,
  onScenarioChange,
  session,
  sessionNotice,
  setupPending,
  checksPending,
  repairPending,
  stalePlanId,
  sessionUnavailable,
  onCreateEnvironment,
  onRunBeforeChecks,
  onRunAfterChecks,
  onSubmitRepair,
}: DashboardProps) {
  const [phase, setPhase] = useState<Phase>('before');
  const [setupApproved, setSetupApproved] = useState(false);
  const [checksApproved, setChecksApproved] = useState(false);
  const [repairApproved, setRepairApproved] = useState(false);
  const [actionNote, setActionNote] = useState<string | null>(null);

  const reports = session?.reports ?? [];
  const selected = [...reports].reverse().find((report) => report.phase === phase) ?? null;
  const beforeReport = [...reports].reverse().find((report) => report.phase === 'before');
  const afterReport = [...reports].reverse().find((report) => report.phase === 'after');
  const plan = selected?.repairPlan ?? beforeReport?.repairPlan;
  const snapshot = session?.snapshot;
  const policy =
    selected?.policy ??
    beforeReport?.policy ??
    afterReport?.policy ??
    (snapshot
      ? {
          trustedIssuer: snapshot.issuerAddress,
          credentialType: snapshot.credentialType,
          requireCurrentAcceptedCredential: true as const,
          individualExceptions: [],
        }
      : undefined);
  const busy = session?.status === 'settingUp' || session?.status === 'checking' || session?.status === 'repairing';
  const mutationsHeld = setupPending || checksPending || repairPending || busy;
  const previewActions = fixtureOn && !busy;
  const evidenceNetwork =
    session?.snapshot?.network === 'devnet' || session?.snapshot?.network === 'testnet'
      ? session.snapshot.network
      : session?.network === 'devnet' || session?.network === 'testnet'
        ? session.network
        : undefined;
  const networkTitle = fixtureOn
    ? 'sample'
    : evidenceNetwork === 'devnet'
      ? 'Devnet'
      : evidenceNetwork === 'testnet'
        ? 'Testnet'
        : 'ledger';
  const readyForChecks =
    !fixtureOn && !sessionUnavailable && session?.status === 'ready' && Boolean(session.snapshot);
  const receipt = session?.repairReceipt;
  const receiptAccepted = receipt?.validated === true && receipt.resultCode === 'tesSUCCESS';
  const repairSucceeded = receiptAccepted && session?.status === 'ready' && !session.error;
  const canRunBefore = readyForChecks && checksApproved && !mutationsHeld && !repairSucceeded;
  const planSource = [...reports].reverse().find((report) => report.repairPlan?.id === plan?.id) ?? null;
  const planNetwork = planSource?.snapshot.network ?? snapshot?.network ?? evidenceNetwork ?? 'Unknown';
  const treasuryAddress = planSource?.snapshot.treasuryAddress ?? snapshot?.treasuryAddress ?? plan?.unsignedTransaction.Account;
  const canApproveRepair =
    !fixtureOn &&
    !sessionUnavailable &&
    session?.status === 'ready' &&
    Boolean(plan) &&
    repairApproved &&
    !mutationsHeld &&
    !repairSucceeded &&
    stalePlanId !== plan?.id;
  const canRunAfter =
    !fixtureOn &&
    !sessionUnavailable &&
    session?.status === 'ready' &&
    repairSucceeded &&
    checksApproved &&
    !mutationsHeld &&
    !afterReport;
  const mismatchRows = selected?.rows.filter((row) => row.verdict === 'mismatch') ?? [];
  const inconclusiveRows =
    selected?.rows.filter((row) => row.verdict === 'inconclusive' || row.observed === 'inconclusive') ?? [];

  useEffect(() => {
    setPhase('before');
    setActionNote(null);
    setRepairApproved(false);
  }, [session?.id]);

  useEffect(() => {
    if (afterReport?.id) {
      setPhase('after');
    }
  }, [afterReport?.id]);

  function previewOnly(action: string) {
    setActionNote(`${action} was not sent. This development fixture does not call the session API.`);
  }

  return (
    <main data-mode={fixtureOn ? 'fixture' : 'real'}>
      <p className="testnet-label">
        {fixtureOn
          ? 'Development fixture / sample data'
          : evidenceNetwork === 'devnet'
            ? 'Devnet / fake funds'
            : evidenceNetwork === 'testnet'
              ? 'Testnet / fake funds'
              : 'Fake funds / network not loaded'}
      </p>
      <h1>GateCheck</h1>
      <p className="lede">
        Compare the intended credential rule with {networkTitle} payment results, then review one direct-approval repair.
      </p>

      {showFixtureSwitch ? (
        <fieldset className="fixture-controls">
          <legend>Layout preview</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={fixtureOn}
              onChange={(event) => onFixtureOnChange(event.target.checked)}
            />
            Development fixture
          </label>
          {fixtureOn ? (
            <label className="scenario">
              Fixture scenario
              <select
                value={scenario}
                onChange={(event) => onScenarioChange(event.target.value as FixtureScenario)}
              >
                {scenarios.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p>The switch is off. Account data comes from the session API, and stays empty until you create an environment.</p>
          )}
        </fieldset>
      ) : null}

      {fixtureOn ? (
        <p className="fixture-banner" role="status">
          Development fixture. Accounts, hashes, and outcomes on this page are sample layout data, not ledger results.
        </p>
      ) : null}

      <section aria-labelledby="connection-heading">
        <h2 id="connection-heading">Connection</h2>
        {health.status === 'loading' ? <p role="status">Checking API health…</p> : null}
        {health.status === 'success' ? <p role="status">API connection: healthy.</p> : null}
        {health.status === 'error' ? <p role="alert">API connection failed: {health.message}</p> : null}
        {session ? (
          <p role="status">
            Session {session.id}. Status {session.status}. Progress: {session.progress}
          </p>
        ) : (
          <p>No session is loaded.</p>
        )}
        {session?.error ? <p role="alert">{session.error}</p> : null}
        {sessionNotice ? <p role="alert">{sessionNotice}</p> : null}
        {actionNote ? <p role="status">{actionNote}</p> : null}
      </section>

      <section aria-labelledby="setup-heading">
        <h2 id="setup-heading">Test environment</h2>
        <label className="check" htmlFor="approve-setup">
          <input
            id="approve-setup"
            type="checkbox"
            checked={setupApproved}
            onChange={(event) => setSetupApproved(event.target.checked)}
          />
          I approve setup transactions using fake funds
        </label>
        <button
          type="button"
          disabled={fixtureOn ? !previewActions || !setupApproved : mutationsHeld || !setupApproved}
          onClick={() => {
            if (fixtureOn) {
              previewOnly('Create test environment');
              return;
            }
            onCreateEnvironment();
          }}
        >
          Create test environment
        </button>
        <p id="setup-hint">
          {fixtureOn
            ? 'Preview only. Turning this on does not create wallets or submit transactions.'
            : 'Setup starts only after you check the box and click. Opening or refreshing this page does not submit transactions.'}
        </p>
      </section>

      <div className="settings-grid">
        <section aria-labelledby="account-heading">
          <h2 id="account-heading">Current account settings</h2>
          {snapshot ? (
            <dl className="facts">
              <dt>Network</dt>
              <dd>{snapshot.network}</dd>
              <dt>Ledger index</dt>
              <dd>{snapshot.ledgerIndex}</dd>
              <dt>Captured</dt>
              <dd>{snapshot.capturedAt}</dd>
              <dt>Treasury</dt>
              <dd>
                <AddressLine value={snapshot.treasuryAddress} label="treasury address" />
              </dd>
              <dt>Issuer</dt>
              <dd>
                <AddressLine value={snapshot.issuerAddress} label="issuer address" />
              </dd>
              <dt>Credential type</dt>
              <dd>{snapshot.credentialType}</dd>
              <dt>Deposit authorization</dt>
              <dd>{snapshot.depositAuthEnabled ? 'Enabled' : 'Disabled'}</dd>
              <dt>Trusted credential rule</dt>
              <dd>{snapshot.trustedCredentialRulePresent ? 'Present' : 'Missing'}</dd>
            </dl>
          ) : (
            <p>Unavailable. Account settings appear after a test environment exists.</p>
          )}
        </section>

        <section aria-labelledby="policy-heading">
          <h2 id="policy-heading">Intended policy</h2>
          <p>
            Only customers with a current accepted credential from the configured issuer may make direct payments. No
            individual exceptions are intended.
          </p>
          {policy ? (
            <dl className="facts">
              <dt>Trusted issuer</dt>
              <dd>
                <AddressLine value={policy.trustedIssuer} label="trusted issuer" />
              </dd>
              <dt>Credential type</dt>
              <dd>{policy.credentialType}</dd>
              <dt>Current credential required</dt>
              <dd>{policy.requireCurrentAcceptedCredential ? 'Yes' : 'No'}</dd>
              <dt>Individual exceptions</dt>
              <dd>{policy.individualExceptions.length === 0 ? 'None' : policy.individualExceptions.join(', ')}</dd>
            </dl>
          ) : (
            <p>Unavailable. The configured issuer is not loaded.</p>
          )}
        </section>
      </div>

      <section aria-labelledby="actors-heading">
        <h2 id="actors-heading">Actor statuses</h2>
        {snapshot && snapshot.actors.length > 0 ? (
          <table>
            <caption>Current credential and direct-approval status for each test actor.</caption>
            <thead>
              <tr>
                <th scope="col">Actor</th>
                <th scope="col">Address</th>
                <th scope="col">Credential</th>
                <th scope="col">Direct approval</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.actors.map((actor) => (
                <tr key={actor.role}>
                  <td>{roleLabels[actor.role]}</td>
                  <td>
                    <AddressLine value={actor.address} label={`${roleLabels[actor.role]} address`} />
                  </td>
                  <td>{actor.credentialStatus}</td>
                  <td>{actor.individuallyApproved ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>Unavailable. Actor statuses appear after a test environment exists.</p>
        )}
      </section>

      <section aria-labelledby="checks-heading">
        <h2 id="checks-heading">Checks</h2>
        <div className="tabs" role="tablist" aria-label="Report phase">
          <button type="button" role="tab" aria-selected={phase === 'before'} onClick={() => setPhase('before')}>
            Before
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={phase === 'after'}
            disabled={!afterReport}
            onClick={() => setPhase('after')}
          >
            After
          </button>
        </div>
        <label className="check" htmlFor="approve-checks">
          <input
            id="approve-checks"
            type="checkbox"
            checked={checksApproved}
            onChange={(event) => setChecksApproved(event.target.checked)}
          />
          I approve this fixed test-payment suite
        </label>
        <div className="actions">
          <button
            type="button"
            disabled={fixtureOn ? !previewActions || !checksApproved : !canRunBefore}
            onClick={() => {
              if (fixtureOn) {
                previewOnly('Run checks');
                return;
              }
              setActionNote(null);
              onRunBeforeChecks();
            }}
          >
            Run checks
          </button>
          <button
            type="button"
            disabled={fixtureOn ? !previewActions || !checksApproved || !beforeReport : !canRunAfter}
            onClick={() => {
              if (fixtureOn) {
                previewOnly('Run after checks');
                return;
              }
              setActionNote(null);
              onRunAfterChecks();
            }}
          >
            Run after checks
          </button>
        </div>
        <p>
          {fixtureOn
            ? 'Preview only. These buttons do not submit payments.'
            : 'Run checks submits the before suite. Run after checks submits the after suite only after a validated tesSUCCESS repair receipt, and only when you check the box and click. Neither runs on its own.'}
        </p>
        {session?.status === 'checking' && !selected ? (
          <p role="status">Checks were accepted and are still running. This report appears when the session includes it.</p>
        ) : null}
        {selected ? (
          <>
            <p>
              {selected.phase === 'before' ? 'Before' : 'After'} report {selected.id}, completed {selected.completedAt}.
            </p>
            <dl className="facts">
              <dt>Report network</dt>
              <dd>{selected.snapshot.network}</dd>
              <dt>Ledger index</dt>
              <dd>{selected.snapshot.ledgerIndex}</dd>
              <dt>Snapshot captured</dt>
              <dd>{selected.snapshot.capturedAt}</dd>
              <dt>Treasury</dt>
              <dd>
                <AddressLine value={selected.snapshot.treasuryAddress} label="report treasury address" />
              </dd>
              <dt>Issuer</dt>
              <dd>
                <AddressLine value={selected.snapshot.issuerAddress} label="report issuer address" />
              </dd>
            </dl>
            <table>
              <caption>Expected policy outcome versus observed ledger outcome.</caption>
              <thead>
                <tr>
                  <th scope="col">Actor</th>
                  <th scope="col">Expected</th>
                  <th scope="col">Observed</th>
                  <th scope="col">Verdict</th>
                  <th scope="col">Validated</th>
                  <th scope="col">Result code</th>
                  <th scope="col">Transaction</th>
                </tr>
              </thead>
              <tbody>
                {selected.rows.map((row) => {
                  const hashLink =
                    row.transactionHash && selected.snapshot.network
                      ? explorerUrl(selected.snapshot.network, row.transactionHash)
                      : null;
                  return (
                    <tr key={`${selected.id}-${row.actor}`} className={`verdict-${row.verdict}`}>
                      <td>{roleLabels[row.actor]}</td>
                      <td>{row.expected === 'allowed' ? 'Allowed' : 'Blocked'}</td>
                      <td>{outcomeLabels[row.observed]}</td>
                      <td>{verdictLabels[row.verdict]}</td>
                      <td>{row.validated ? 'Yes' : 'No'}</td>
                      <td>{row.resultCode ?? 'None'}</td>
                      <td>
                        {row.transactionHash ? (
                          <span className="address">
                            {hashLink && !fixtureOn ? (
                              <a href={hashLink}>{row.transactionHash}</a>
                            ) : (
                              <code>{row.transactionHash}</code>
                            )}
                            <CopyButton value={row.transactionHash} label={`${roleLabels[row.actor]} transaction hash`} />
                          </span>
                        ) : (
                          'None'
                        )}
                        {row.error ? <span className="row-error">{row.error}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {mismatchRows.length > 0 ? (
              <div className="mismatch" role="status">
                <h3>Mismatch</h3>
                <p>The intended policy differs from the ledger configuration. These explanations come from the report.</p>
                {mismatchRows.map((row) => (
                  <p key={row.actor}>{row.explanation}</p>
                ))}
              </div>
            ) : (
              <p>No mismatch in this report.</p>
            )}
            {inconclusiveRows.length > 0 ? (
              <div className="inconclusive" role="status">
                <h3>Inconclusive</h3>
                <p>These rows are inconclusive. They are not treated as allowed or blocked.</p>
                {inconclusiveRows.map((row) => (
                  <p key={`${row.actor}-inconclusive`}>
                    {roleLabels[row.actor]}: {row.explanation}
                    {row.error ? ` ${row.error}` : ''}
                  </p>
                ))}
              </div>
            ) : null}
            <h3>Row notes</h3>
            <ul>
              {selected.rows.map((row) => (
                <li key={`${selected.id}-${row.actor}-note`}>
                  {roleLabels[row.actor]}: {row.explanation}
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => downloadReport(selected)}>
              Download JSON report
            </button>
          </>
        ) : (
          <>
            <p>{phase === 'after' ? 'No after report is available.' : 'No check results yet.'}</p>
            <button type="button" disabled>
              Download JSON report
            </button>
          </>
        )}
      </section>

      <section aria-labelledby="repair-heading">
        <h2 id="repair-heading">Repair</h2>
        {plan ? (
          <>
            <p>{plan.description}</p>
            <p>Session network: {planNetwork}. That field is the ledger network. The description above is the stored plan text.</p>
            <dl className="facts">
              <dt>Plan id</dt>
              <dd>
                <code>{plan.id}</code>
              </dd>
              <dt>Session network</dt>
              <dd>{planNetwork}</dd>
              <dt>Treasury</dt>
              <dd>
                <AddressLine value={treasuryAddress ?? 'Unknown'} label="treasury address" />
              </dd>
              <dt>Affected address</dt>
              <dd>
                <AddressLine value={plan.affectedAddress} label="affected address" />
              </dd>
              <dt>Transaction type</dt>
              <dd>{plan.unsignedTransaction.TransactionType}</dd>
              <dt>Account</dt>
              <dd>
                <AddressLine value={plan.unsignedTransaction.Account} label="repair account" />
              </dd>
              <dt>Unauthorize</dt>
              <dd>
                <AddressLine value={plan.unsignedTransaction.Unauthorize} label="unauthorize address" />
              </dd>
            </dl>
            <label className="check" htmlFor="approve-repair">
              <input
                id="approve-repair"
                type="checkbox"
                checked={repairApproved}
                onChange={(event) => setRepairApproved(event.target.checked)}
              />
              I approve this {fixtureOn ? 'sample' : networkTitle} configuration change for the affected address
            </label>
            <div className="actions">
              <button
                type="button"
                disabled={fixtureOn ? !previewActions || !repairApproved || repairSucceeded : !canApproveRepair}
                onClick={() => {
                  if (fixtureOn) {
                    previewOnly('Repair approval');
                    return;
                  }
                  setActionNote(null);
                  onSubmitRepair(plan.id);
                }}
              >
                Approve repair
              </button>
              <button
                type="button"
                disabled={fixtureOn ? !previewActions || repairSucceeded : mutationsHeld || repairSucceeded}
                onClick={() => {
                  if (fixtureOn) {
                    previewOnly('Repair cancel');
                    return;
                  }
                  setRepairApproved(false);
                  setActionNote('Cancel was not sent. No repair request was made.');
                }}
              >
                Cancel
              </button>
            </div>
            <p>
              {fixtureOn
                ? 'Cancel sends no repair request. Approve does not submit a transaction from this layout preview.'
                : stalePlanId === plan.id
                  ? 'This stored plan was rejected as stale. Approve stays disabled. Rerun before checks only if you want a new plan.'
                  : 'Cancel sends no repair request. Approve submits this stored plan only after you check the box and click. A 202 response is not success.'}
            </p>
          </>
        ) : (
          <p>No repair is proposed. A repair appears only when a validated allowed payment contradicts an intended block.</p>
        )}
        {repairSucceeded ? (
          <p role="status">Repair succeeded. The backend returned a validated tesSUCCESS receipt.</p>
        ) : session?.status === 'repairing' ? (
          <p role="status">Repair was accepted and is still running. Success waits for a validated tesSUCCESS receipt.</p>
        ) : receiptAccepted ? (
          <p role="alert">A validated tesSUCCESS receipt is stored, but the session did not return to ready. The plan will not be submitted again.</p>
        ) : receipt ? (
          <p role="alert">A repair receipt is present, but it is not a validated tesSUCCESS result.</p>
        ) : (
          <p>No validated repair receipt.</p>
        )}
        {receipt ? (
          <dl className="facts">
            <dt>Repair receipt</dt>
            <dd>
              <span className="address">
                {fixtureOn || (planNetwork !== 'devnet' && planNetwork !== 'testnet') ? (
                  <code>{receipt.transactionHash}</code>
                ) : (
                  <a href={explorerUrl(planNetwork, receipt.transactionHash) ?? undefined}>{receipt.transactionHash}</a>
                )}
                <CopyButton value={receipt.transactionHash} label="repair transaction hash" />
              </span>
            </dd>
            <dt>Result code</dt>
            <dd>{receipt.resultCode}</dd>
            <dt>Validated</dt>
            <dd>{receipt.validated ? 'Yes' : 'No'}</dd>
          </dl>
        ) : null}
      </section>
    </main>
  );
}
