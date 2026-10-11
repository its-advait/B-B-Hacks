import { mkdir, appendFile, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import type { SubmittableTransaction } from 'xrpl'
import { client } from './client.js'
import { signingWallet } from './accounts.js'
import type { TransactionResult } from './types.js'

const pending = new Map<string, string>()
const inFlight = new Set<string>()

async function unresolvedTransaction(sender: string): Promise<string | null> {
  const file = join(resolve(process.env.GATECHECK_RUNTIME_DIR ?? '.runtime'), 'transactions.jsonl')
  let contents: string
  try { contents = await readFile(file, 'utf8') }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
  const outstanding = new Set<string>()
  for (const line of contents.split('\n').filter(Boolean)) {
    const event: unknown = JSON.parse(line)
    if (typeof event !== 'object' || event === null || !('sender' in event) || event.sender !== sender || !('transactionHash' in event) || typeof event.transactionHash !== 'string') continue
    if ('stage' in event && event.stage === 'prepared') outstanding.add(event.transactionHash)
    if ('validated' in event && event.validated === true) outstanding.delete(event.transactionHash)
  }
  for (const hash of outstanding) {
    try {
      const found = await client.request({ command: 'tx', transaction: hash })
      if (found.result.validated === true) {
        await journal({ stage: 'reconciled', sender, transactionHash: hash, validated: true, ...classifyOutcome(true, found.result.meta), ledgerIndex: found.result.ledger_index })
        pending.delete(sender)
        continue
      }
    } catch { /* Unknown remains unknown; never resubmit another payment. */ }
    return hash
  }
  return null
}
export function classifyOutcome(validated: boolean, meta: unknown): { resultCode: string; successful: boolean | null } {
  if (!validated || typeof meta !== 'object' || meta === null || !('TransactionResult' in meta) || typeof meta.TransactionResult !== 'string') {
    return { resultCode: 'INCONCLUSIVE', successful: null }
  }
  return { resultCode: meta.TransactionResult, successful: meta.TransactionResult === 'tesSUCCESS' }
}
async function journal(record: object): Promise<void> {
  const dir = resolve(process.env.GATECHECK_RUNTIME_DIR ?? '.runtime')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await appendFile(join(dir, 'transactions.jsonl'), `${JSON.stringify(record)}\n`, { mode: 0o600 })
}
export async function submitTransaction(transaction: SubmittableTransaction): Promise<TransactionResult> {
  if (inFlight.has(transaction.Account)) throw new Error('Another transaction for this account is already being submitted')
  inFlight.add(transaction.Account)
  try { return await submitUnlocked(transaction) }
  finally { inFlight.delete(transaction.Account) }
}
async function submitUnlocked(transaction: SubmittableTransaction): Promise<TransactionResult> {
  const wallet = signingWallet(transaction.Account)
  const unresolved = await unresolvedTransaction(wallet.address)
  if (unresolved || pending.has(wallet.address)) throw new Error(`Unreconciled transaction ${unresolved ?? pending.get(wallet.address)}; query its hash before submitting again`)
  const filled = await client.autofill(transaction)
  if (filled.Sequence === undefined || filled.LastLedgerSequence === undefined) throw new Error('Autofill did not provide sequence/expiry')
  const signed = wallet.sign(filled)
  const base: TransactionResult = {
    transactionHash: signed.hash, validated: false, resultCode: 'INCONCLUSIVE', successful: null,
    ledgerIndex: null, sender: wallet.address, sequence: filled.Sequence, lastLedgerSequence: filled.LastLedgerSequence,
  }
  pending.set(wallet.address, signed.hash)
  await journal({ stage: 'prepared', ...base, transaction: filled })
  try {
    const response = await client.submitAndWait(signed.tx_blob)
    const outcome = classifyOutcome(response.result.validated === true, response.result.meta)
    const receipt = { ...base, ...outcome, validated: response.result.validated === true, ledgerIndex: response.result.ledger_index ?? null }
    await journal({ stage: 'outcome', ...receipt })
    if (receipt.validated) pending.delete(wallet.address)
    return receipt
  } catch (error) {
    // A response timeout can happen after inclusion: query the original hash.
    try {
      const found = await client.request({ command: 'tx', transaction: signed.hash })
      if (found.result.validated === true) {
        const receipt = { ...base, ...classifyOutcome(true, found.result.meta), validated: true, ledgerIndex: found.result.ledger_index ?? null }
        await journal({ stage: 'reconciled', ...receipt })
        pending.delete(wallet.address)
        return receipt
      }
    } catch { /* No proven outcome: preserve hash and report uncertainty. */ }
    const receipt = { ...base, error: error instanceof Error ? error.message : 'Submission failed without validated outcome' }
    await journal({ stage: 'inconclusive', ...receipt })
    return receipt
  }
}
export function requireSuccess(result: TransactionResult): TransactionResult {
  if (!result.validated || result.resultCode !== 'tesSUCCESS') {
    throw new Error(`Transaction ${result.transactionHash}: ${result.resultCode}. ${result.error ?? ''}`)
  }
  return result
}
