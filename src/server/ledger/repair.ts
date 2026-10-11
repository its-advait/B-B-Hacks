import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { XRPL_URL } from './client.js'
import { readPermissions } from './permissions.js'
import { submitTransaction } from './transactions.js'
import type { CredentialRef, Permissions, RepairApproval, RepairPlan, RepairResult } from './types.js'

const directory = resolve(process.env.GATECHECK_RUNTIME_DIR ?? '.runtime', 'plans')
type StoredPlan = { plan: RepairPlan; refs: CredentialRef[]; status: 'pending' | 'submitting' | 'consumed'; approval?: RepairApproval; approvedAt?: string }
const locks = new Set<string>()
function planFile(id: string): string {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid plan ID')
  return join(directory, `${id}.json`)
}
export function validateRepairApproval(plan: RepairPlan, approval: RepairApproval, current: Permissions, now = Date.now()): void {
  if (approval.approved !== true || approval.planId !== plan.id || !approval.approvedBy?.trim()) throw new Error('Explicit operator approval for this exact plan is required')
  if (Date.parse(plan.expiresAt) <= now) throw new Error('Plan expired; preview again')
  if (current.account !== plan.company || current.fingerprint !== plan.stateFingerprint) throw new Error('Authorization state changed; preview and approve a fresh plan')
  if (!current.depositAuth || !current.directApprovals.some(rule => rule.account === plan.target)) throw new Error('Expected direct approval no longer exists')
  if (plan.transaction.Account !== plan.company || plan.transaction.TransactionType !== 'DepositPreauth' || !('Unauthorize' in plan.transaction) || plan.transaction.Unauthorize !== plan.target) throw new Error('Plan transaction does not match reviewed removal')
}
export async function previewRemoveDirectApproval(company: string, target: string, refs: CredentialRef[] = []): Promise<RepairPlan> {
  const current = await readPermissions(company, refs)
  if (!current.depositAuth || !current.directApprovals.some(rule => rule.account === target)) throw new Error('No direct wallet approval to remove')
  const plan: RepairPlan = {
    id: randomUUID(), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    networkUrl: XRPL_URL, company, target, stateFingerprint: current.fingerprint,
    transaction: { TransactionType: 'DepositPreauth', Account: company, Unauthorize: target },
    summary: 'Remove only this direct wallet approval. Credential-based approvals and every other wallet approval remain unchanged.',
  }
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await writeFile(planFile(plan.id), JSON.stringify({ plan, refs, status: 'pending' } satisfies StoredPlan), { flag: 'wx', mode: 0o600 })
  return plan
}
export async function removeDirectApproval(planId: string, approval: RepairApproval): Promise<RepairResult> {
  if (locks.has(planId)) throw new Error('Plan is already being applied')
  locks.add(planId)
  try {
    const file = planFile(planId)
    const saved = JSON.parse(await readFile(file, 'utf8')) as StoredPlan
    if (saved.status !== 'pending') throw new Error('Plan already submitted; reconcile its journal receipt, do not reapply')
    if (saved.plan.networkUrl !== XRPL_URL) throw new Error('Plan network mismatch')
    const current = await readPermissions(saved.plan.company, saved.refs)
    validateRepairApproval(saved.plan, approval, current)
    saved.status = 'submitting'
    saved.approval = approval
    saved.approvedAt = new Date().toISOString()
    await writeFile(file, JSON.stringify(saved), { mode: 0o600 })
    const receipt = await submitTransaction(saved.plan.transaction)
    saved.status = 'consumed'
    await writeFile(file, JSON.stringify(saved), { mode: 0o600 })
    const permissions = receipt.validated ? await readPermissions(saved.plan.company, saved.refs) : null
    if (receipt.successful && permissions?.directApprovals.some(rule => rule.account === saved.plan.target)) throw new Error('Validated repair did not remove expected approval')
    return { receipt, permissions }
  } finally { locks.delete(planId) }
}
