import { writeFile, mkdir } from 'node:fs/promises'
import { createDemoEnvironment, readSnapshot, sendTestPayment, removeIndividualApproval, disconnectLedger } from '../src/server/ledger/index.js'
import type { ActorRole, PaymentObservation, AccountSnapshot } from '../src/shared/contracts.js'

// Explicit operator approval is required before the one repair transaction is submitted.
const approved = process.argv.includes('--approve')
const ACTORS: ActorRole[] = ['validCustomer', 'legacyCustomer', 'stranger']

// Redact anything secret-shaped before printing. Public addresses and hashes are kept.
function redact<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).replace(/\bs[1-9A-HJ-NP-Za-km-z]{25,35}\b/g, '[REDACTED_SEED]')) as T
}

function summarize(stage: string, snapshot: AccountSnapshot, observations: PaymentObservation[] = []) {
  return {
    stage,
    ledgerIndex: snapshot.ledgerIndex,
    depositAuthEnabled: snapshot.depositAuthEnabled,
    actors: snapshot.actors.map(a => ({ role: a.role, address: a.address, credentialStatus: a.credentialStatus, individuallyApproved: a.individuallyApproved })),
    payments: observations.map(o => ({ actor: o.actor, observed: o.observed, validated: o.validated, resultCode: o.resultCode, transactionHash: o.transactionHash, error: o.error })),
  }
}

async function payAll(session: Awaited<ReturnType<typeof createDemoEnvironment>>): Promise<PaymentObservation[]> {
  const observations: PaymentObservation[] = []
  for (const actor of ACTORS) observations.push(await sendTestPayment(session, actor))
  return observations
}

const report: Record<string, unknown> = { approvedRepair: approved, startedAt: new Date().toISOString() }
try {
  const session = await createDemoEnvironment(message => console.log(`[setup] ${message}`))
  const before = await readSnapshot(session)
  const beforePayments = await payAll(session)
  report.before = summarize('before', before, beforePayments)
  console.log(JSON.stringify(report.before, null, 2))

  if (!approved) {
    console.log('Repair not submitted. Re-run with --approve to remove only the reviewed legacy direct approval.')
  } else {
    const receipt = await removeIndividualApproval(session, before.actors.find(a => a.role === 'legacyCustomer')!.address)
    report.repair = receipt
    const after = await readSnapshot(session)
    const afterPayments = await payAll(session)
    report.after = summarize('after', after, afterPayments)
    console.log(JSON.stringify({ repair: receipt, after: report.after }, null, 2))
  }
  report.finishedAt = new Date().toISOString()
  await mkdir('evidence', { recursive: true })
  await writeFile('evidence/smoke-run.json', JSON.stringify(redact(report), null, 2))
  console.log('Wrote evidence/smoke-run.json (redacted).')
} finally {
  await disconnectLedger()
}
