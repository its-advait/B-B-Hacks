import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { Wallet } from 'xrpl'
import { client, connectLedger, XRPL_URL } from './client.js'
import type { Accounts, Role } from './types.js'

export const privateDir = resolve(process.env.GATECHECK_PRIVATE_DIR ?? '.private')
const file = join(privateDir, 'wallets.json')
const roles: Role[] = ['company', 'alice', 'bob', 'charlie', 'issuer']
const wallets = new Map<string, Wallet>()
type SavedWallets = { networkUrl: string; seeds: Partial<Record<Role, string>> }

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
export async function createTestAccounts(): Promise<Accounts> {
  await connectLedger()
  await mkdir(privateDir, { recursive: true, mode: 0o700 })
  let saved: SavedWallets = { networkUrl: XRPL_URL, seeds: {} }
  try { saved = JSON.parse(await readFile(file, 'utf8')) as SavedWallets }
  catch (error) { if (!isMissing(error)) throw error }
  if (saved.networkUrl !== XRPL_URL) throw new Error('Saved wallets belong to another network; use a new private directory')
  const addresses: Partial<Accounts> = {}
  for (const role of roles) {
    const seed = saved.seeds[role]
    const wallet = seed ? Wallet.fromSeed(seed) : Wallet.generate()
    if (!seed) {
      saved.seeds[role] = wallet.seed
      // Save before faucet request so interrupted funding never loses keys.
      await writeFile(`${file}.tmp`, JSON.stringify(saved), { mode: 0o600 })
      await rename(`${file}.tmp`, file)
    }
    let funded = true
    try { await client.request({ command: 'account_info', account: wallet.address, ledger_index: 'validated' }) }
    catch (error) {
      const data = error instanceof Error && 'data' in error ? error.data : null
      if (data && typeof data === 'object' && 'error' in data && data.error === 'actNotFound') funded = false
      else throw error
    }
    if (!funded) await client.fundWallet(wallet, { amount: '100' })
    wallets.set(wallet.address, wallet)
    addresses[role] = wallet.address
  }
  const { company, alice, bob, charlie, issuer } = addresses
  if (!company || !alice || !bob || !charlie || !issuer) throw new Error('Incomplete disposable account set')
  return { company, alice, bob, charlie, issuer }
}

// Server-internal only. Not exported from the public ledger index.
export function signingWallet(address: string): Wallet {
  const wallet = wallets.get(address)
  if (!wallet) throw new Error('Signing is restricted to GateCheck disposable accounts')
  return wallet
}
