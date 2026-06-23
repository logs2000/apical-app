'use client'

import * as React from 'react'
import { useCredentials, useProvisionCredential } from '@/lib/queries'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { useToast } from '@/hooks/use-toast'
import { relativeTime } from '@/lib/apical'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import {
  Vault as VaultIcon,
  KeyRound,
  Sparkles,
  Bot,
  CreditCard,
  Zap,
  Plus,
  ChevronDown,
  ShieldCheck,
  Lock,
  Search,
  Fingerprint,
  ArrowRight,
  Loader2,
} from 'lucide-react'
import type { Credential, CredentialKind } from '@/lib/types'

// ----------------------------------------------------------------------------
// Maps
// ----------------------------------------------------------------------------

const KIND_META: Record<CredentialKind, { label: string; cls: string }> = {
  oauth: { label: 'OAuth', cls: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-500' },
  apikey: { label: 'API key', cls: 'border-violet-500/40 bg-violet-500/15 text-violet-500' },
  payment: { label: 'Payment', cls: 'border-amber-500/40 bg-amber-500/15 text-amber-500' },
  mcp_token: { label: 'MCP token', cls: 'border-teal-500/40 bg-teal-500/15 text-teal-500' },
}

const STATUS_META: Record<Credential['status'], { label: string; cls: string; pulse?: boolean }> = {
  active: { label: 'Active', cls: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-500' },
  provisioning: { label: 'Provisioning', cls: 'border-primary/40 bg-primary/15 text-primary', pulse: true },
  expired: { label: 'Expired', cls: 'border-border bg-muted text-muted-foreground' },
  revoked: { label: 'Revoked', cls: 'border-destructive/40 bg-destructive/15 text-destructive' },
}

// Stable color per service name for the letter avatar.
const AVATAR_COLORS = [
  'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  'bg-rose-500/15 text-rose-500 border-rose-500/30',
  'bg-amber-500/15 text-amber-500 border-amber-500/30',
  'bg-violet-500/15 text-violet-500 border-violet-500/30',
  'bg-sky-500/15 text-sky-500 border-sky-500/30',
  'bg-teal-500/15 text-teal-500 border-teal-500/30',
]

function colorFor(service: string): string {
  let h = 0
  for (let i = 0; i < service.length; i++) h = (h * 31 + service.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

// ----------------------------------------------------------------------------
// Provision dialog
// ----------------------------------------------------------------------------

function ProvisionDialog() {
  const [open, setOpen] = React.useState(false)
  const [service, setService] = React.useState('')
  const [kind, setKind] = React.useState<CredentialKind>('apikey')
  const provision = useProvisionCredential()
  const { toast } = useToast()

  const submit = async () => {
    const s = service.trim()
    if (!s) {
      toast({ title: 'Service name required', variant: 'destructive' })
      return
    }
    try {
      const c = await provision.mutateAsync({ service: s, kind })
      toast({
        title: `Agent opened a new ${s} account.`,
        description: c.status === 'active' ? 'Credential is active and ready to use.' : 'Provisioning in progress.',
      })
      setOpen(false)
      setService('')
      setKind('apikey')
    } catch (e) {
      toast({ title: 'Provisioning failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Provision new credential
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Provision a credential</DialogTitle>
          <DialogDescription>
            The agent will open an account or request an API key on your behalf. Anything touching identity or money
            is gated for your approval.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cred-service">Service</Label>
            <Input
              id="cred-service"
              value={service}
              onChange={(e) => setService(e.target.value)}
              placeholder="e.g. hubspot, docusign, sendgrid"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Kind</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as CredentialKind)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="oauth">OAuth</SelectItem>
                <SelectItem value="apikey">API key</SelectItem>
                <SelectItem value="payment">Payment</SelectItem>
                <SelectItem value="mcp_token">MCP token</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={provision.isPending} className="gap-1.5">
            {provision.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
            Provision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ----------------------------------------------------------------------------
// Stat tile
// ----------------------------------------------------------------------------

function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  delay,
}: {
  label: string
  value: React.ReactNode
  sub?: string
  icon: React.ComponentType<{ className?: string }>
  accent?: string
  delay: number
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <Card className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
            {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
          </div>
          <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', accent ?? 'bg-muted text-muted-foreground')}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </Card>
    </motion.div>
  )
}

// ----------------------------------------------------------------------------
// Credential card
// ----------------------------------------------------------------------------

function MetaRows({ meta }: { meta: Record<string, unknown> }) {
  const entries = Object.entries(meta).filter(([k]) => k !== 'step')
  if (entries.length === 0) return null
  return (
    <div className="mt-2 grid grid-cols-1 gap-1 rounded-lg border border-border/60 bg-muted/30 p-2 sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-baseline gap-1.5 px-1 py-0.5 text-[11px]">
          <span className="shrink-0 text-muted-foreground">{k}</span>
          <span className="truncate font-mono text-foreground">
            {Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}
          </span>
        </div>
      ))}
    </div>
  )
}

function CredentialCard({ cred, delay }: { cred: Credential; delay: number }) {
  const [open, setOpen] = React.useState(false)
  const kindMeta = KIND_META[cred.kind]
  const statusMeta = STATUS_META[cred.status]
  const avatarColor = colorFor(cred.service)
  const provisionStep = typeof cred.meta?.step === 'string' ? (cred.meta.step as string) : null

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <Card className="overflow-hidden">
        <div className="p-4">
          <div className="flex items-start gap-3">
            {/* Avatar */}
            <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border font-mono text-sm font-semibold uppercase', avatarColor)}>
              {cred.service.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium">{cred.service}</span>
                <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px] font-medium', kindMeta.cls)}>
                  {kindMeta.label}
                </span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
                    statusMeta.cls,
                    statusMeta.pulse && 'animate-pulse-soft',
                  )}
                >
                  {cred.status === 'provisioning' && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                  {statusMeta.label}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">{cred.label}</p>
            </div>
          </div>

          {/* Capability badges */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {cred.agentProvisioned && (
              <Badge variant="outline" className="gap-1 border-primary/30 text-primary text-[10px]" title={typeof cred.meta?.openedAt === 'string' ? `Opened ${relativeTime(cred.meta.openedAt as string)}` : undefined}>
                <Bot className="h-2.5 w-2.5" />
                Agent-opened
              </Badge>
            )}
            {cred.canPay && (
              <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-500 text-[10px]">
                <CreditCard className="h-2.5 w-2.5" />
                Can pay
              </Badge>
            )}
            {provisionStep && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                step: <code className="font-mono">{provisionStep}</code>
              </span>
            )}
            {cred.agentProvisioned && typeof cred.meta?.note === 'string' && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <Sparkles className="h-2.5 w-2.5 text-primary" />
                <span className="truncate">{cred.meta.note as string}</span>
              </span>
            )}
          </div>

          {/* Expandable meta */}
          {Object.keys(cred.meta ?? {}).length > 0 && (
            <Collapsible open={open} onOpenChange={setOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="mt-1 h-7 gap-1 px-2 text-[11px] text-muted-foreground">
                  {open ? 'Hide details' : 'Details'}
                  <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <MetaRows meta={cred.meta ?? {}} />
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>

        <div className="border-t border-border/60 bg-muted/20 px-4 py-2 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <KeyRound className="h-2.5 w-2.5" />
            Added {relativeTime(cred.createdAt)}
          </span>
        </div>
      </Card>
    </motion.div>
  )
}

// ----------------------------------------------------------------------------
// Architecture flow
// ----------------------------------------------------------------------------

const ARCH_STEPS = [
  {
    n: 1,
    label: 'Discover',
    icon: Search,
    body: 'The agent identifies a service it needs from a workflow\u2019s tool requirements.',
  },
  {
    n: 2,
    label: 'Provision',
    icon: Fingerprint,
    body: 'It opens an account or requests an API key, gated by your approval for anything that costs money or touches identity.',
  },
  {
    n: 3,
    label: 'Vault',
    icon: Lock,
    body: 'Credentials are stored encrypted. The agent retrieves them at runtime and never logs them.',
  },
  {
    n: 4,
    label: 'Act',
    icon: Zap,
    body: 'Including payments \u2014 always behind a gate for amounts over a threshold you set.',
  },
]

function ArchitectureFlow() {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium">How the AI-auth layer works</h3>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {ARCH_STEPS.map((s, i) => {
          const Icon = s.icon
          return (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="relative rounded-lg border border-border/60 bg-card/40 p-3"
            >
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div>
                  <div className="text-[10px] font-mono text-muted-foreground">Step {s.n}</div>
                  <div className="text-sm font-medium">{s.label}</div>
                </div>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{s.body}</p>
              {i < ARCH_STEPS.length - 1 && (
                <ArrowRight className="absolute -right-2.5 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-muted-foreground/40 lg:block" />
              )}
            </motion.div>
          )
        })}
      </div>
      <p className="mt-3 rounded-lg border border-dashed border-border bg-muted/20 p-2.5 text-[11px] text-muted-foreground">
        This module runs independently — point any agent at the Vault API and it can provision, retrieve, and pay
        without the workflow engine.
      </p>
    </Card>
  )
}

// ----------------------------------------------------------------------------
// View
// ----------------------------------------------------------------------------

export function VaultView() {
  const { data: creds, isLoading } = useCredentials()

  const stats = React.useMemo(() => {
    const list = creds ?? []
    return {
      total: list.length,
      active: list.filter((c) => c.status === 'active').length,
      agentOpened: list.filter((c) => c.agentProvisioned).length,
      canPay: list.filter((c) => c.canPay).length,
    }
  }, [creds])

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <VaultIcon className="h-4 w-4 text-muted-foreground" />
            Vault
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Credentials agents can provision, retrieve, and pay with.</p>
        </div>
        <ProvisionDialog />
      </div>

      {/* Explainer banner */}
      <Card className="relative overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-4">
        <div className="bg-dots absolute inset-0 opacity-30" />
        <div className="relative flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-medium">The AI-auth layer</h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              The Vault is what lets an agent act on your behalf without you babysitting every connection. It provisions
              accounts, retrieves auth keys, and can even make payments — all with your sign-off on the risky parts.
              It works with the workflow engine, but also stands alone.
            </p>
          </div>
        </div>
      </Card>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Credentials" value={isLoading ? '\u2014' : stats.total} icon={KeyRound} accent="bg-primary/10 text-primary" delay={0.05} />
        <StatTile label="Active" value={isLoading ? '\u2014' : stats.active} sub="ready to use" icon={ShieldCheck} accent="bg-emerald-500/10 text-emerald-500" delay={0.1} />
        <StatTile label="Agent-opened" value={isLoading ? '\u2014' : stats.agentOpened} sub="provisioned by the agent" icon={Bot} accent="bg-reason/15 text-reason" delay={0.15} />
        <StatTile label="Payment-capable" value={isLoading ? '\u2014' : stats.canPay} sub="can charge on your behalf" icon={CreditCard} accent="bg-amber-500/10 text-amber-500" delay={0.2} />
      </div>

      {/* Credentials list */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : !creds || creds.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <VaultIcon className="h-5 w-5" />
          </div>
          <h3 className="text-sm font-medium">No credentials yet</h3>
          <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
            Provision one and the agent will open the account for you.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {creds.map((c, i) => (
            <CredentialCard key={c.id} cred={c} delay={i * 0.04} />
          ))}
        </div>
      )}

      {/* Architecture */}
      <ArchitectureFlow />
    </div>
  )
}
