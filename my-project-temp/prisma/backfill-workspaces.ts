// Apical — workspace tenancy backfill.
//
// The renovation makes Workspace the core tenant: every resource gets a
// workspaceId, users access workspaces through WorkspaceMember rows, and the
// legacy PersonalAccessToken / DeveloperAccount+ApiKey auth tables are merged
// into the unified workspace-scoped ApiKey table (mapped to "WorkspaceApiKey").
//
// Because the project evolves its schema with `prisma db push` (no migration
// framework), this script runs in two stages around the push:
//
//   1. BEFORE `prisma db push`:
//        npx tsx prisma/backfill-workspaces.ts export
//      Snapshots the legacy auth tables (PersonalAccessToken, DeveloperAccount,
//      ApiKey) to prisma/legacy-auth-backup.json. Tolerant of missing tables.
//
//   2. AFTER `prisma db push`:
//        npx tsx prisma/backfill-workspaces.ts import
//      - Ensures every user has a personal workspace + owner WorkspaceMember.
//      - Assigns workspaceId to workflows, credentials, conversations,
//        scheduled jobs, data tables, data connections, and assets.
//      - Recreates API keys in the unified table:
//          ap_pat_ tokens → user's personal workspace (all scopes)
//          ap_sk_ keys    → a workspace created from the DeveloperAccount
//                           (plan + balanceCents + billing carried over)
//
// Idempotent: safe to re-run (keys are looked up by hash; workspaces by
// member row; resource updates only touch rows with workspaceId IS NULL).

import { PrismaClient } from '@prisma/client'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const prisma = new PrismaClient()
const BACKUP_PATH = join(__dirname, 'legacy-auth-backup.json')

interface LegacyPat {
  id: string
  userId: string
  label: string
  tokenHash: string
  tokenPrefix: string
  status: string
}

interface LegacyDevKey {
  id: string
  developerId: string
  label: string
  keyHash: string
  keyPrefix: string
  status: string
}

interface LegacyDeveloper {
  id: string
  email: string
  name: string
  workspaceId: string | null
  plan: string
  balanceCents: number
  billingEmail: string | null
  stripeCustomerId: string | null
  status: string
}

interface Backup {
  pats: LegacyPat[]
  developers: LegacyDeveloper[]
  devKeys: LegacyDevKey[]
}

async function tableRows<T>(table: string): Promise<T[]> {
  try {
    return await prisma.$queryRawUnsafe<T[]>(`SELECT * FROM "${table}"`)
  } catch {
    console.log(`  (table "${table}" not found — skipping)`)
    return []
  }
}

async function exportLegacy(): Promise<void> {
  console.log('[backfill] exporting legacy auth tables…')
  const backup: Backup = {
    pats: await tableRows<LegacyPat>('PersonalAccessToken'),
    developers: await tableRows<LegacyDeveloper>('DeveloperAccount'),
    devKeys: await tableRows<LegacyDevKey>('ApiKey'),
  }
  writeFileSync(BACKUP_PATH, JSON.stringify(backup, null, 2))
  console.log(
    `[backfill] wrote ${BACKUP_PATH}: ${backup.pats.length} PATs, ` +
      `${backup.developers.length} developer accounts, ${backup.devKeys.length} dev keys.`,
  )
}

/** Ensure the user has a personal workspace + owner membership. Returns its id. */
async function ensurePersonalWorkspace(userId: string, userName: string | null): Promise<string> {
  // 1. Existing membership wins.
  const member = await prisma.workspaceMember.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  })
  if (member) return member.workspaceId

  // 2. Legacy-owned workspace (Workspace.userId) — adopt it.
  const legacy = await prisma.workspace.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  })
  const ws =
    legacy ??
    (await prisma.workspace.create({
      data: {
        userId,
        name: userName ? `${userName}'s Workspace` : 'Personal',
        description: 'Personal workspace',
      },
    }))
  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: ws.id, userId } },
    update: {},
    create: { workspaceId: ws.id, userId, role: 'owner' },
  })
  return ws.id
}

async function importLegacy(): Promise<void> {
  const backup: Backup = existsSync(BACKUP_PATH)
    ? (JSON.parse(readFileSync(BACKUP_PATH, 'utf8')) as Backup)
    : { pats: [], developers: [], devKeys: [] }

  // ---- 1. Personal workspace per user + resource backfill ----
  const users = await prisma.user.findMany({ select: { id: true, name: true } })
  console.log(`[backfill] ensuring workspaces for ${users.length} user(s)…`)
  const wsByUser = new Map<string, string>()
  for (const u of users) {
    const wsId = await ensurePersonalWorkspace(u.id, u.name)
    wsByUser.set(u.id, wsId)
  }

  console.log('[backfill] assigning workspaceId to resources…')
  for (const [userId, wsId] of wsByUser) {
    const where = { userId, workspaceId: null }
    const results = await Promise.all([
      prisma.workflow.updateMany({ where, data: { workspaceId: wsId } }),
      prisma.credential.updateMany({ where, data: { workspaceId: wsId } }),
      prisma.conversation.updateMany({ where, data: { workspaceId: wsId } }),
      prisma.scheduledJob.updateMany({ where, data: { workspaceId: wsId } }),
      prisma.dataTable.updateMany({ where, data: { workspaceId: wsId } }),
      prisma.dataConnection.updateMany({ where, data: { workspaceId: wsId } }),
      prisma.userAsset.updateMany({ where, data: { workspaceId: wsId } }),
    ])
    const touched = results.reduce((n, r) => n + r.count, 0)
    if (touched > 0) console.log(`  user ${userId}: ${touched} rows → workspace ${wsId}`)
  }

  // ---- 1b. Ownerless Integration rows (registry vs. instance split) ----
  // builtin/public rows stay global (workspaceId null = registry). Ownerless
  // PRIVATE rows are instances that predate tenancy — the Integration table
  // never had a userId column, so ownership can't be recovered exactly.
  // Heuristic: assign them to the oldest workspace (single-tenant dev data).
  const orphanPrivate = await prisma.integration.count({
    where: { workspaceId: null, source: 'private' },
  })
  if (orphanPrivate > 0) {
    const oldestWs = await prisma.workspace.findFirst({ orderBy: { createdAt: 'asc' } })
    if (oldestWs) {
      const res = await prisma.integration.updateMany({
        where: { workspaceId: null, source: 'private' },
        data: { workspaceId: oldestWs.id },
      })
      console.log(
        `[backfill] assigned ${res.count} ownerless private integration(s) → workspace ${oldestWs.id}`,
      )
    } else {
      console.warn(
        `[backfill] ${orphanPrivate} ownerless private integration(s) but no workspace exists — left global`,
      )
    }
  }

  // ---- 2. PATs → unified ApiKey in the user's personal workspace ----
  console.log(`[backfill] migrating ${backup.pats.length} PAT(s)…`)
  for (const pat of backup.pats) {
    const wsId = wsByUser.get(pat.userId)
    if (!wsId) {
      console.warn(`  PAT ${pat.tokenPrefix}… has no user ${pat.userId}; skipping`)
      continue
    }
    await prisma.apiKey.upsert({
      where: { keyHash: pat.tokenHash },
      update: {},
      create: {
        workspaceId: wsId,
        createdById: pat.userId,
        label: pat.label,
        keyHash: pat.tokenHash,
        keyPrefix: pat.tokenPrefix,
        scopesJson: '[]', // legacy = all scopes
        status: pat.status,
      },
    })
  }

  // ---- 3. DeveloperAccounts → workspaces; dev keys → unified ApiKey ----
  console.log(`[backfill] migrating ${backup.developers.length} developer account(s)…`)
  const wsByDeveloper = new Map<string, string>()
  for (const dev of backup.developers) {
    // Attach to the matching user's personal workspace when emails line up;
    // otherwise create a dedicated workspace for the developer account.
    const user = await prisma.user.findUnique({ where: { email: dev.email } })
    let wsId = user ? wsByUser.get(user.id) : undefined
    if (!wsId) {
      const existing = await prisma.workspace.findFirst({
        where: { billingEmail: dev.email },
      })
      wsId =
        existing?.id ??
        (
          await prisma.workspace.create({
            data: {
              name: dev.name || `${dev.email} (developer)`,
              description: 'Migrated developer account',
              billingEmail: dev.email,
            },
          })
        ).id
    }
    await prisma.workspace.update({
      where: { id: wsId },
      data: {
        plan: dev.plan,
        balanceCents: { increment: dev.balanceCents },
        billingEmail: dev.billingEmail ?? dev.email,
        stripeCustomerId: dev.stripeCustomerId ?? undefined,
        status: dev.status,
      },
    })
    wsByDeveloper.set(dev.id, wsId)
  }

  console.log(`[backfill] migrating ${backup.devKeys.length} developer key(s)…`)
  for (const key of backup.devKeys) {
    const wsId = wsByDeveloper.get(key.developerId)
    if (!wsId) {
      console.warn(`  key ${key.keyPrefix}… has no developer ${key.developerId}; skipping`)
      continue
    }
    await prisma.apiKey.upsert({
      where: { keyHash: key.keyHash },
      update: {},
      create: {
        workspaceId: wsId,
        label: key.label,
        keyHash: key.keyHash,
        keyPrefix: key.keyPrefix,
        scopesJson: '[]', // legacy = all scopes
        status: key.status,
      },
    })
  }

  console.log('[backfill] done.')
}

async function main() {
  const mode = process.argv[2]
  if (mode === 'export') {
    await exportLegacy()
  } else if (mode === 'import') {
    await importLegacy()
  } else {
    console.log('Usage: npx tsx prisma/backfill-workspaces.ts <export|import>')
    console.log('  export — BEFORE `prisma db push`: snapshot legacy auth tables')
    console.log('  import — AFTER  `prisma db push`: create workspaces + migrate keys')
    process.exit(1)
  }
}

main()
  .catch((err) => {
    console.error('[backfill] failed:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
