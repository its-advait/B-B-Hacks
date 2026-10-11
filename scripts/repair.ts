import { readFile, writeFile } from 'node:fs/promises'
import { createTestAccounts, connectLedger, disconnectLedger, removeDirectApproval, runPaymentSuite } from '../src/server/ledger/index.js'
const args = process.argv.slice(2)
const value = (flag: string) => args[args.indexOf(flag) + 1]
try {
  const planId = args.includes('--plan') ? value('--plan') : undefined
  const operator = args.includes('--operator') ? value('--operator') : undefined
  if (!planId || !operator || !args.includes('--approve')) throw new Error('Required: --plan ID --approve --operator NAME (review evidence/before.json first)')
  await connectLedger()
  const accounts = await createTestAccounts()
  const repair = await removeDirectApproval(planId, { approved: true, planId, approvedBy: operator })
  if (!repair.receipt.validated || !repair.receipt.successful) throw new Error(`Repair not confirmed: ${JSON.stringify(repair.receipt)}`)
  const after = await runPaymentSuite(accounts)
  console.table(after.map(test => ({ customer: test.customer, expected: test.expectedAllowed, validated: test.receipt.validated, actual: test.receipt.successful, code: test.receipt.resultCode, hash: test.receipt.transactionHash })))
  const before: unknown = JSON.parse(await readFile('evidence/before.json', 'utf8'))
  await writeFile('evidence/live-demo.json', JSON.stringify({ before, repair, after, capturedAt: new Date().toISOString() }, null, 2))
  if (!after.every(test => test.receipt.validated && test.matchesPolicy === true) || after[1]?.receipt.resultCode !== 'tecNO_PERMISSION') throw new Error('Regression suite did not pass')
  console.log('Actual ledger test-and-repair loop passed. Evidence: evidence/live-demo.json')
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 }
finally { await disconnectLedger() }
