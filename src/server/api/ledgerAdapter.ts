import { LedgerUnavailableError, unavailableLedgerPort, type LedgerPort } from './ledgerPort.js';

const AGREED_EXPORTS = [
  'createDemoEnvironment',
  'readSnapshot',
  'sendTestPayment',
  'removeIndividualApproval',
] as const;

const LEDGER_SPECIFIER = '../ledger/index.js';

type LedgerModule = Record<string, unknown>;

async function importLedgerModule(): Promise<LedgerModule> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<LedgerModule>;
  return dynamicImport(LEDGER_SPECIFIER);
}

function portFromModule(mod: LedgerModule): LedgerPort {
  const missing = AGREED_EXPORTS.filter((name) => typeof mod[name] !== 'function');
  if (missing.length > 0) {
    throw new LedgerUnavailableError(
      `Ledger module src/server/ledger/index.ts is missing agreed exports: ${missing.join(', ')}. Live jobs are not simulated.`,
    );
  }

  const createDemoEnvironment = mod.createDemoEnvironment as LedgerPort['createDemoEnvironment'];
  const readSnapshot = mod.readSnapshot as LedgerPort['readSnapshot'];
  const sendTestPayment = mod.sendTestPayment as LedgerPort['sendTestPayment'];
  const removeIndividualApproval = mod.removeIndividualApproval as LedgerPort['removeIndividualApproval'];

  return {
    createDemoEnvironment,
    readSnapshot,
    sendTestPayment,
    removeIndividualApproval,
  };
}

/**
 * Loads teammate A's module when it exports the frozen signatures.
 * A missing module or a different export set stays unavailable.
 * This never substitutes a successful fixture.
 */
export async function loadLedgerPort(): Promise<LedgerPort> {
  try {
    const mod = await importLedgerModule();
    return portFromModule(mod);
  } catch (error) {
    if (error instanceof LedgerUnavailableError) {
      return unavailableLedgerPort(error.message);
    }
    const detail = error instanceof Error ? error.message : 'import failed';
    return unavailableLedgerPort(
      `Ledger module src/server/ledger/index.ts is not available (${detail}). Live jobs are not simulated.`,
    );
  }
}
