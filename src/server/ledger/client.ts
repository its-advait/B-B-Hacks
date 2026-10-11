import 'dotenv/config'
import { Client } from 'xrpl'
import type { NetworkProof } from './types.js'

export const XRPL_URL = process.env.XRPL_URL ?? 'wss://s.devnet.rippletest.net:51233'
const endpoint = new URL(XRPL_URL)
const networks = {
  's.devnet.rippletest.net': { name: 'devnet', id: 2 },
  's.altnet.rippletest.net': { name: 'testnet', id: 1 },
} as const
const network = networks[endpoint.hostname as keyof typeof networks]
if (!network || endpoint.protocol !== 'wss:') {
  throw new Error('Only official Devnet/Testnet WSS endpoints are supported; no production funds.')
}
if (process.env.GATECHECK_NETWORK && process.env.GATECHECK_NETWORK !== network.name) {
  throw new Error('GATECHECK_NETWORK does not match XRPL_URL')
}
export const client = new Client(XRPL_URL, { timeout: 20000, connectionTimeout: 20000 })
export const AMENDMENTS = {
  Credentials: '1CB67D082CF7D9102412D34258CEDB400E659352D3B207348889297A6D90F5EF',
  DepositAuth: 'F64E1EABBE79D55B3BB82020516CEC2C582A98A6BFE20FBE9BB6A0D233418064',
  DepositPreauth: '3CBC5C4E630A1B82380295CDA84B32B49DD066602E74E39B85EF64137FA65194',
}
export const AMENDMENTS_ID = '7DB0788C020F02780A673DC74757F23823FA3014C1866E72CC4CD8B226CD6EF4'

export async function connectLedger(): Promise<NetworkProof> {
  if (!client.isConnected()) await client.connect()
  const info = await client.request({ command: 'server_info' })
  if (info.result.info.network_id !== network.id) throw new Error('Server network ID mismatch')
  const ledger = await client.request({ command: 'ledger', ledger_index: 'validated' })
  const entry = await client.request({ command: 'ledger_entry', index: AMENDMENTS_ID, ledger_index: ledger.result.ledger_index })
  const node = entry.result.node
  if (entry.result.validated !== true || node.LedgerEntryType !== 'Amendments') {
    throw new Error('Cannot verify amendments against validated ledger')
  }
  const amendments = Object.fromEntries(Object.entries(AMENDMENTS).map(([name, id]) => [name, (node.Amendments ?? []).includes(id)]))
  if (Object.values(amendments).some(enabled => !enabled)) {
    throw new Error(`Required amendments unavailable: ${JSON.stringify(amendments)}`)
  }
  return {
    url: XRPL_URL, network: network.name, networkId: network.id,
    ledgerIndex: ledger.result.ledger_index, ledgerHash: ledger.result.ledger_hash, amendments,
  }
}

export async function disconnectLedger(): Promise<void> {
  if (client.isConnected()) await client.disconnect()
}
