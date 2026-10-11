import { createALedgerPort, missingAExports, type ALedgerModule } from './aLedger.js';
import { LedgerUnavailableError, unavailableLedgerPort, type LedgerPort } from './ledgerPort.js';

const LEDGER_SPECIFIER = '../ledger/index.js';

async function importLedgerModule(): Promise<Partial<ALedgerModule>> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<Partial<ALedgerModule>>;
  return dynamicImport(LEDGER_SPECIFIER);
}

/**
 * Binds teammate A's real exports.
 * A missing module stays unavailable. Jobs are not replaced with scripted successes.
 */
export async function loadLedgerPort(): Promise<LedgerPort> {
  try {
    const mod = await importLedgerModule();
    const missing = missingAExports(mod);
    if (missing.length > 0) {
      throw new LedgerUnavailableError(
        `Ledger module src/server/ledger/index.ts is missing exports: ${missing.join(', ')}. Live jobs are not simulated.`,
      );
    }
    return createALedgerPort(mod as ALedgerModule);
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
