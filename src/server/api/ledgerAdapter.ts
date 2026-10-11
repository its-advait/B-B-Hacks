import { createALedgerPort, missingAExports, type ALedgerModule } from './aLedger.js';
import { createFrozenLedgerPort, hasFrozenLedgerExports } from './frozenLedger.js';
import { LedgerUnavailableError, unavailableLedgerPort, type LedgerPort } from './ledgerPort.js';

const LEDGER_SPECIFIER = '../ledger/index.js';

async function importLedgerModule(): Promise<object> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<object>;
  return dynamicImport(LEDGER_SPECIFIER);
}

/**
 * Prefer A's frozen compatibility exports when the module provides them.
 * Otherwise use the original lower-level exports. A missing module stays unavailable.
 */
export function portFromLedgerModule(mod: object): LedgerPort {
  if (hasFrozenLedgerExports(mod)) {
    return createFrozenLedgerPort(mod);
  }
  const missing = missingAExports(mod as Partial<ALedgerModule>);
  if (missing.length > 0) {
    throw new LedgerUnavailableError(
      `Ledger module src/server/ledger/index.ts is missing exports: ${missing.join(', ')}. Live jobs are not simulated.`,
    );
  }
  return createALedgerPort(mod as ALedgerModule);
}

export async function loadLedgerPort(): Promise<LedgerPort> {
  try {
    return portFromLedgerModule(await importLedgerModule());
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
