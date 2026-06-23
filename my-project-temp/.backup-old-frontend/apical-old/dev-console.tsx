'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  useDevAccount, useDevLogin, useDevRegister, useDevLogout,
  useDevKeys, useCreateDevKey, useRevokeDevKey,
  useDevUsage, useDevLogs, useDevBilling, useDevTopup, useDevChangePlan,
  useDevDeploy, useDevDocs,
  type DeveloperAccount, type ApiKeyRow, type AuditLogRow,
} from '@/lib/queries'
import { useToast } from '@/hooks/use-toast'
import { formatCurrency, relativeTime } from '@/lib/apical'
import {
  ArrowLeft, KeyRound, Plus, Trash2, Copy, Check, Activity, DollarSign,
  CreditCard, Terminal, BookOpen, Rocket, LogOut, Zap, TrendingUp,
  CheckCircle2, XCircle, ExternalLink, ChevronRight,
} from 'lucide-react'

type DevTab = 'overview' | 'keys' | 'deploy' | 'logs' | 'billing' | 'docs'

// ---------------- Auth gate ----------------
function DevAuthGate() {
  const [mode, setMode] = React.useState<'login' | 'register'>('login')
  const [apiKey, setApiKey] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [name, setName] = React.useState('')
  const [rawKey, setRawKey] = React.useState<string | null>(null)
  const login = useDevLogin()
  const register = useDevRegister()
  const { toast } = useToast()

  const handleLogin = async () => {
    if (!apiKey.trim()) return
    try {
      await login.mutateAsync({ apiKey: apiKey.trim() })
      toast({ title: 'Logged in' })
    } catch (e) {
      toast({ title: 'Invalid API key', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const handleRegister = async () => {
    if (!email.trim()) return
    try {
      const res = await register.mutateAsync({ email: email.trim(), name: name.trim() || undefined })
      setRawKey(res.apiKey.raw)
      toast({ title: 'Account created', description: '$5.00 free credit added.' })
    } catch (e) {
      toast({ title: 'Registration failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <h1 className="text-xl font-semibold tracking-tight">Apical for Developers</h1>
          <p className="mt-1 text-sm text-muted-foreground">Deploy and run automations via MCP or REST. Pay per run.</p>
        </div>

        {rawKey ? (
          <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="text-sm font-medium">Your API key</span>
            </div>
            <p className="text-xs text-muted-foreground">Copy this now — it won't be shown again.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-card px-2 py-1.5 font-mono text-xs">{rawKey}</code>
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(rawKey); toast({ title: 'Copied' }) }}>
                <Copy className="h-3 w-3" />
              </Button>
            </div>
            <Button className="w-full" onClick={() => window.location.reload()}>Continue to console</Button>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex gap-1 rounded-lg border border-border p-0.5">
              {(['login', 'register'] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)}
                  className={cn('flex-1 rounded-md py-1 text-xs font-medium', mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground')}>
                  {m === 'login' ? 'Log in' : 'Sign up'}
                </button>
              ))}
            </div>
            {mode === 'login' ? (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">API key</Label>
                  <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="ap_sk_..." className="font-mono text-sm" onKeyDown={(e) => e.key === 'Enter' && handleLogin()} />
                </div>
                <Button className="w-full" onClick={handleLogin} disabled={login.isPending || !apiKey.trim()}>
                  {login.isPending ? 'Verifying…' : 'Log in'}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Email</Label>
                  <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="text-sm" />
                </div>
                <div>
                  <Label className="text-xs">Name (optional)</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="text-sm" />
                </div>
                <Button className="w-full" onClick={handleRegister} disabled={register.isPending || !email.trim()}>
                  {register.isPending ? 'Creating…' : 'Create account · $5 free credit'}
                </Button>
              </div>
            )}
          </div>
        )}
        <p className="text-center text-[10px] text-muted-foreground">
          Demo: log in with the seeded key prefix <code className="font-mono">ap_sk_demo_</code>
        </p>
      </div>
    </div>
  )
}

// ---------------- Overview tab ----------------
function OverviewTab({ account, onNav }: { account: DeveloperAccount; onNav: (t: DevTab) => void }) {
  const { data: usage } = useDevUsage(30)
  const { data: logs } = useDevLogs(5)
  const planLabel = { free: 'Free', starter: 'Starter', pro: 'Pro', scale: 'Scale' }[account.plan]

  const stats = [
    { label: 'Balance', value: formatCurrency(account.balanceCents), icon: DollarSign, accent: 'text-emerald-500', tab: 'billing' as DevTab },
    { label: 'Plan', value: planLabel, icon: Zap, accent: 'text-primary', tab: 'billing' as DevTab },
    { label: 'Calls (30d)', value: usage?.totalCalls?.toLocaleString() ?? '—', icon: Activity, accent: 'text-foreground', tab: 'logs' as DevTab },
    { label: 'Success rate', value: usage ? `${usage.successRate}%` : '—', icon: TrendingUp, accent: 'text-emerald-500', tab: 'logs' as DevTab },
  ]

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-gradient-to-br from-primary/10 to-card p-4">
        <h2 className="text-base font-semibold">Welcome, {account.name || account.email}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Deploy automations via MCP or REST. Pay per run. Watch your agents work.</p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => onNav('deploy')}><Rocket className="mr-1 h-3 w-3" /> Deploy</Button>
          <Button size="sm" variant="outline" onClick={() => onNav('docs')}><BookOpen className="mr-1 h-3 w-3" /> Docs</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s, i) => (
          <motion.button key={s.label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            onClick={() => onNav(s.tab)} className="rounded-xl border border-border bg-card p-3 text-left hover:border-primary/30">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{s.label}</span>
              <s.icon className={cn('h-3 w-3', s.accent)} />
            </div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{s.value}</div>
          </motion.button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><Activity className="h-4 w-4 text-muted-foreground" /> Recent activity</h3>
          {logs?.length === 0 ? <p className="text-xs text-muted-foreground">No calls yet.</p> : (
            <div className="space-y-1.5">
              {logs?.map((l) => <LogRow key={l.id} log={l} compact />)}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><Rocket className="h-4 w-4 text-muted-foreground" /> Quick deploy</h3>
          <p className="text-xs text-muted-foreground">Paste an Automation File JSON and deploy it instantly.</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => onNav('deploy')}>Open deploy →</Button>
        </div>
      </div>
    </div>
  )
}

// ---------------- Keys tab ----------------
function KeysTab() {
  const { data: keys } = useDevKeys()
  const createKey = useCreateDevKey()
  const revokeKey = useRevokeDevKey()
  const [label, setLabel] = React.useState('')
  const [newRaw, setNewRaw] = React.useState<string | null>(null)
  const { toast } = useToast()

  const handleCreate = async () => {
    if (!label.trim()) return
    try {
      const res = await createKey.mutateAsync({ label: label.trim() })
      setNewRaw(res.raw)
      setLabel('')
      toast({ title: 'Key created' })
    } catch (e) { toast({ title: 'Failed', description: (e as Error).message, variant: 'destructive' }) }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">API Keys</h2>
        <p className="text-sm text-muted-foreground">Use these to authenticate MCP + REST calls. Keys are hashed at rest — the raw key is shown once.</p>
      </div>

      {newRaw && (
        <div className="space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /><span className="text-sm font-medium">New key — copy it now</span></div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-card px-2 py-1 font-mono text-xs">{newRaw}</code>
            <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(newRaw); toast({ title: 'Copied' }) }}><Copy className="h-3 w-3" /></Button>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setNewRaw(null)}>Dismiss</Button>
        </div>
      )}

      <div className="flex gap-2">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Key label (e.g. Production)" className="text-sm" onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
        <Button onClick={handleCreate} disabled={createKey.isPending || !label.trim()}><Plus className="mr-1 h-3 w-3" /> Create</Button>
      </div>

      <div className="space-y-2">
        {keys?.map((k) => <KeyRow key={k.id} k={k} onRevoke={() => revokeKey.mutate(k.id)} />)}
      </div>
    </div>
  )
}

function KeyRow({ k, onRevoke }: { k: ApiKeyRow; onRevoke: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
      <KeyRound className={cn('h-4 w-4 shrink-0', k.status === 'active' ? 'text-primary' : 'text-muted-foreground')} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{k.label}</span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{k.prefix}…</code>
          {k.status === 'revoked' && <Badge variant="destructive" className="text-[9px]">Revoked</Badge>}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {k.lastUsedAt ? `Last used ${relativeTime(k.lastUsedAt)} from ${k.lastUsedFrom ?? '—'}` : 'Never used'} · Created {relativeTime(k.createdAt)}
        </div>
      </div>
      {k.status === 'active' && (
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onRevoke}><Trash2 className="h-3 w-3" /></Button>
      )}
    </div>
  )
}

// ---------------- Deploy tab ----------------
function DeployTab() {
  const deploy = useDevDeploy()
  const { toast } = useToast()
  const [json, setJson] = React.useState(`{
  "name": "Webhook Relay",
  "title": "Relay Agent",
  "department": "Dispatch",
  "trigger": { "type": "manual" },
  "steps": [
    { "id": "s1", "kind": "tool", "label": "Fetch payload", "tool": "files.read", "inputs": { "path": "/tmp/webhook.json" } },
    { "id": "s2", "kind": "tool", "label": "Forward to API", "http": { "method": "POST", "url": "https://api.example.com/ingest", "auth": { "type": "bearer", "ref": "cred_example" } } }
  ]
}`)

  const handleDeploy = async () => {
    try {
      const workflow = JSON.parse(json)
      const res = await deploy.mutateAsync({ workflow })
      toast({ title: `Deployed ${res.agent.name}`, description: `${res.integrationsCreated} integrations installed` })
    } catch (e) {
      toast({ title: 'Deploy failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Deploy from JSON</h2>
        <p className="text-sm text-muted-foreground">Paste an Automation File. Same format the MCP <code className="font-mono">apical_deploy</code> tool accepts.</p>
      </div>
      <div className="space-y-2">
        <Textarea value={json} onChange={(e) => setJson(e.target.value)} rows={18} className="font-mono text-xs" />
        <Button onClick={handleDeploy} disabled={deploy.isPending}><Rocket className="mr-1 h-3 w-3" /> {deploy.isPending ? 'Deploying…' : 'Deploy'}</Button>
      </div>
    </div>
  )
}

// ---------------- Logs tab ----------------
function LogsTab() {
  const { data: logs } = useDevLogs(50)
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Audit log</h2>
        <p className="text-sm text-muted-foreground">Every MCP + REST call, append-only. Used for billing + forensics.</p>
      </div>
      <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
        {logs?.map((l) => <LogRow key={l.id} log={l} />)}
      </div>
    </div>
  )
}

function LogRow({ log, compact }: { log: AuditLogRow; compact?: boolean }) {
  const ok = log.success
  return (
    <div className={cn('flex items-start gap-2 rounded-lg border border-border/60 bg-card/60 p-2', compact && 'py-1.5')}>
      {ok ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <code className="font-mono text-[11px] font-medium">{log.action}</code>
          {log.target && <code className="truncate font-mono text-[10px] text-muted-foreground">{log.target}</code>}
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{relativeTime(log.createdAt)}</span>
        </div>
        {log.detail && <div className="truncate text-[11px] text-muted-foreground">{log.detail}</div>}
      </div>
      {log.costCents > 0 && <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] font-mono">{log.costCents}¢</span>}
      <span className="shrink-0 rounded bg-muted/60 px-1 py-0.5 text-[9px] text-muted-foreground">{log.source}</span>
    </div>
  )
}

// ---------------- Billing tab ----------------
function BillingTab({ account }: { account: DeveloperAccount }) {
  const { data: billing } = useDevBilling()
  const topup = useDevTopup()
  const changePlan = useDevChangePlan()
  const { toast } = useToast()
  const plans = [
    { id: 'free', name: 'Free', price: '$0', features: ['100 runs/mo', 'Community tools', '1 workspace'] },
    { id: 'starter', name: 'Starter', price: '$19/mo', features: ['5K runs/mo', 'Private integrations', '3 workspaces'] },
    { id: 'pro', name: 'Pro', price: '$99/mo', features: ['50K runs/mo', 'Vault + secrets', '10 workspaces', 'Priority support'] },
    { id: 'scale', name: 'Scale', price: 'Custom', features: ['Unlimited runs', 'SSO + audit', 'Self-host option', 'SLA'] },
  ]

  const handleTopup = async (cents: number) => {
    try { await topup.mutateAsync({ amountCents: cents }); toast({ title: `Added ${formatCurrency(cents)}` }) }
    catch (e) { toast({ title: 'Failed', description: (e as Error).message, variant: 'destructive' }) }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Billing</h2>
        <p className="text-sm text-muted-foreground">Prepaid credits — runs deduct from your balance. Top up anytime.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Balance</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{formatCurrency(account.balanceCents)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Current plan</div>
          <div className="mt-1 text-2xl font-semibold capitalize">{account.plan}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Spent (30d)</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{formatCurrency(billing?.recentCharges?.reduce((s, l) => s + l.costCents, 0) ?? 0)}</div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><CreditCard className="h-4 w-4" /> Top up credits</h3>
        <div className="flex flex-wrap gap-2">
          {[500, 1000, 2500, 5000].map((c) => (
            <Button key={c} size="sm" variant="outline" onClick={() => handleTopup(c)} disabled={topup.isPending}>
              +{formatCurrency(c)}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">Demo mode — real Stripe checkout wiring is stubbed.</p>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">Plans</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((p) => (
            <div key={p.id} className={cn('rounded-xl border bg-card p-3', account.plan === p.id ? 'border-primary' : 'border-border')}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{p.name}</span>
                {account.plan === p.id && <Badge className="text-[9px]">Current</Badge>}
              </div>
              <div className="mt-1 text-xl font-semibold">{p.price}</div>
              <ul className="mt-2 space-y-0.5">
                {p.features.map((f) => <li key={f} className="flex items-center gap-1 text-[11px] text-muted-foreground"><Check className="h-2.5 w-2.5 text-emerald-500" /> {f}</li>)}
              </ul>
              {account.plan !== p.id && (
                <Button size="sm" variant="outline" className="mt-2 w-full text-xs" onClick={() => changePlan.mutate({ plan: p.id })} disabled={changePlan.isPending}>
                  Switch to {p.name}
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------- Docs tab ----------------
function DocsTab() {
  const { data: docs } = useDevDocs()
  const { toast } = useToast()
  const [copied, setCopied] = React.useState<string | null>(null)
  const copy = (text: string, id: string) => { navigator.clipboard.writeText(text); setCopied(id); toast({ title: 'Copied' }); setTimeout(() => setCopied(null), 1500) }

  const cursorConfig = `{
  "mcpServers": {
    "apical": {
      "command": "npx",
      "args": ["apical-mcp"],
      "env": { "APICAL_API_KEY": "ap_sk_..." }
    }
  }
}`

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold">Documentation</h2>
        <p className="text-sm text-muted-foreground">Everything a SaaS developer needs to deploy + run automations.</p>
      </div>

      {/* Quickstart */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><Terminal className="h-4 w-4" /> Quickstart — connect your AI editor</h3>
        <p className="mb-2 text-xs text-muted-foreground">Add the Apical MCP server to Cursor, Claude Desktop, or Windsurf. Your agent can then deploy + run automations by calling tools.</p>
        <div className="relative">
          <pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 font-mono text-[11px]"><code>{cursorConfig}</code></pre>
          <Button size="sm" variant="outline" className="absolute right-2 top-2 h-6 text-[10px]" onClick={() => copy(cursorConfig, 'cursor')}>
            {copied === 'cursor' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Get your API key from the <button className="text-primary underline" onClick={() => copy('ap_sk_demo_', 'demokey')}>Keys tab</button>.</p>
      </section>

      {/* MCP tools */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><Zap className="h-4 w-4" /> MCP tools</h3>
        <div className="space-y-2">
          {docs?.mcp?.tools?.map((t) => (
            <div key={t.name} className="rounded-lg border border-border/60 bg-card/60 p-2.5">
              <div className="flex items-center gap-2">
                <code className="font-mono text-xs font-semibold text-primary">{t.name}</code>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{t.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* REST API */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><BookOpen className="h-4 w-4" /> REST API</h3>
        <p className="mb-2 text-[11px] text-muted-foreground">Base: <code className="font-mono">{docs?.rest?.baseUrl}</code> · Auth: <code className="font-mono">{typeof docs?.rest?.auth === 'string' ? docs.rest.auth : (docs?.rest?.auth as { header?: string })?.header ?? 'bearer'}</code></p>
        <div className="space-y-2">
          {docs?.rest?.endpoints?.map((r) => (
            <div key={r.path} className="rounded-lg border border-border/60 bg-card/60 p-2.5">
              <div className="flex items-center gap-2">
                <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold',
                  r.method === 'GET' ? 'bg-emerald-500/15 text-emerald-500' : r.method === 'POST' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')}>{r.method}</span>
                <code className="font-mono text-xs">{r.path}</code>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{r.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Plans */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><DollarSign className="h-4 w-4" /> Plans</h3>
        <p className="mb-2 text-[11px] text-muted-foreground">{typeof docs?.pricing?.note === 'string' ? docs.pricing.note : ''}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {docs?.pricing?.plans?.map((p) => {
            const price = typeof p === 'object' && p !== null && 'priceCents' in p
              ? (p as { priceCents: number }).priceCents === 0 ? 'Free' : `$${(p as { priceCents: number }).priceCents / 100}/mo`
              : typeof (p as { price?: string }).price === 'string' ? (p as { price: string }).price : '—'
            const name = typeof (p as { name?: string }).name === 'string' ? (p as { name: string }).name : 'Plan'
            const features = Array.isArray((p as { features?: string[] }).features) ? (p as { features: string[] }).features : []
            return (
              <div key={name} className="rounded-lg border border-border/60 p-2.5">
                <div className="text-sm font-semibold">{name}</div>
                <div className="text-lg font-semibold">{price}</div>
                <ul className="mt-1 space-y-0.5">
                  {features.map((f) => <li key={f} className="text-[10px] text-muted-foreground">• {f}</li>)}
                </ul>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

// ---------------- Main console ----------------
const TABS: { key: DevTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'overview', label: 'Overview', icon: Activity },
  { key: 'keys', label: 'API Keys', icon: KeyRound },
  { key: 'deploy', label: 'Deploy', icon: Rocket },
  { key: 'logs', label: 'Logs', icon: Terminal },
  { key: 'billing', label: 'Billing', icon: CreditCard },
  { key: 'docs', label: 'Docs', icon: BookOpen },
]

export function SaaSDeveloperConsole() {
  const { data: account, isLoading } = useDevAccount()
  const logout = useDevLogout()
  const [tab, setTab] = React.useState<DevTab>('overview')

  if (isLoading) return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>
  if (!account) return <DevAuthGate />

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 md:px-4">
        <button onClick={() => window.location.href = '/'} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Back to app</span>
        </button>
        <span className="mx-2 text-muted-foreground/30">/</span>
        <span className="text-sm font-semibold">Apical for Developers</span>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline" className="capitalize">{account.plan}</Badge>
          <span className="text-xs text-muted-foreground">{formatCurrency(account.balanceCents)}</span>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => logout.mutate()}><LogOut className="h-3 w-3" /></Button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Tab rail */}
        <nav className="hidden md:flex w-44 shrink-0 flex-col gap-0.5 border-r border-border p-2">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn('flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                tab === t.key ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')}>
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </nav>
        {/* Mobile tabs */}
        <div className="md:hidden flex overflow-x-auto border-b border-border px-2 py-1.5 gap-1">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn('flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium',
                tab === t.key ? 'bg-primary/10 text-foreground' : 'text-muted-foreground')}>
              <t.icon className="h-3 w-3" /> {t.label}
            </button>
          ))}
        </div>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl px-4 py-5 md:px-6">
            {tab === 'overview' && <OverviewTab account={account} onNav={setTab} />}
            {tab === 'keys' && <KeysTab />}
            {tab === 'deploy' && <DeployTab />}
            {tab === 'logs' && <LogsTab />}
            {tab === 'billing' && <BillingTab account={account} />}
            {tab === 'docs' && <DocsTab />}
          </div>
        </main>
      </div>
    </div>
  )
}
