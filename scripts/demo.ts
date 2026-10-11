import { mkdir, writeFile } from 'node:fs/promises'
import { connectLedger, disconnectLedger, createTestAccounts, setupPermissions, runPaymentSuite, previewRemoveDirectApproval, customerRefs } from '../src/server/ledger/index.js'
try {
  const network = await connectLedger()
  console.log('Network verified:', network)
  const accounts = await createTestAccounts()
  console.log('Disposable addresses:', accounts)
  const setup = await setupPermissions(accounts)
  const before = await runPaymentSuite(accounts)
  console.table(before.map(test => ({ customer: test.customer, expected: test.expectedAllowed, validated: test.receipt.validated, actual: test.receipt.successful, code: test.receipt.resultCode, hash: test.receipt.transactionHash })))
  if (!before.every(test => test.receipt.validated) || before[0]?.receipt.successful !== true || before[1]?.receipt.successful !== true || before[2]?.receipt.resultCode !== 'tecNO_PERMISSION') throw new Error('Live counterexample did not reproduce; inspect receipts')
  const plan = await previewRemoveDirectApproval(accounts.company, accounts.bob, customerRefs(accounts))
  const report = { scope: 'Real Devnet/Testnet direct XRP payments; disposable test funds only', capturedAt: new Date().toISOString(), network, accounts, setup, before, plan }
  await mkdir('evidence', { recursive: true })
  await writeFile('evidence/before.json', JSON.stringify(report, null, 2))
  console.log('Before evidence saved. No repair submitted. Review plan:', plan)
  console.log(`Approve explicitly with: npm run repair -- --plan ${plan.id} --approve --operator YOUR_NAME`)
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 }
finally { await disconnectLedger() }
