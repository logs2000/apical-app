'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  Activity,
  ArrowRight,
  Copy,
  KeyRound,
  Loader2,
  LogOut,
  Plus,
  Rocket,
  Trash2,
  User,
} from 'lucide-react'

import { ApicalMark } from '@/components/apical/logo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'

// ─── Types ───────────────────────────────────────────────────────────────────

interface DevAccount {
  id: string
  email: string
  name: string
  plan: string
  balanceCents: number
  status: string
}

interface ApiKeyRow {
  id: string
  label: string
  prefix: string
  lastUsedAt: string | null
  lastUsedFrom: string | null
  status: 'active' | 'revoked'
  createdAt: string
}

interface AgentRow {
  id: string
  name: string
  description?: string | null
  status?: string | null
  updatedAt?: string | null
}

interface UsageStats {
  totalCalls: number
  totalCostCents: number
  callsByAction: Record<string, number>
  callsByDay: { date: string; calls: number; costCents: number }[]
  agentsDeployed: number
  runsTriggered: number
  successRate: number
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DeveloperPage() {
  const { toast } = useToast()
  const [account, setAccount] = React.useState<DevAccount | null>(null)
  const [bootLoading, setBootLoading] = React.useState(true)

  const refreshAccount = React.useCallback(async () => {
    const res = await fetch('/api/dev/account')
    if (res.ok) {
      setAccount(await res.json())
      return true
    }
    setAccount(null)
    return false
  }, [])

  React.useEffect(() => {
    ;(async () => {
      await refreshAccount()
      setBootLoading(false)
    })()
  }, [refreshAccount])

  const handleLogout = async () => {
    await fetch('/api/dev/auth/logout', { method: 'POST' })
    setAccount(null)
    toast({ title: 'Signed out', description: 'Developer console session cleared.' })
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <ApicalMark className="h-6 w-6" />
            <span className="text-sm font-semibold tracking-tight">
              Apical<span className="text-brand">.</span>
            </span>
            <span className="ml-2 text-xs text-muted-foreground">Developer</span>
          </Link>
          <nav className="flex items-center gap-4 text-xs text-muted-foreground">
            <Link href="/docs" className="hover:text-foreground">
              Docs
            </Link>
            {account && (
              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {bootLoading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading developer console…
          </div>
        ) : !account ? (
          <AuthGate onAuthenticated={refreshAccount} />
        ) : (
          <Console account={account} onAccountChanged={refreshAccount} />
        )}
      </main>
    </div>
  )
}

// ─── Auth gate (sign in with API key or create account) ──────────────────────

function AuthGate({ onAuthenticated }: { onAuthenticated: () => Promise<boolean> }) {
  const { toast } = useToast()
  const [mode, setMode] = React.useState<'login' | 'register'>('login')
  const [loading, setLoading] = React.useState(false)

  // login fields
  const [apiKey, setApiKey] = React.useState('')
  // register fields
  const [email, setEmail] = React.useState('')
  const [name, setName] = React.useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch(
        mode === 'login' ? '/api/dev/auth/login' : '/api/dev/auth/register',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            mode === 'login' ? { apiKey } : { email, name },
          ),
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed')
      }
      toast({
        title: mode === 'login' ? 'Signed in' : 'Account created',
        description:
          mode === 'login'
            ? 'Welcome back to the developer console.'
            : 'Your developer account is ready. $5.00 starting credit applied.',
      })
      if (mode === 'register' && data?.apiKey) {
        toast({
          title: 'Save your API key',
          description: `Your initial key: ${data.apiKey.raw}`,
        })
      }
      await onAuthenticated()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed'
      toast({ title: 'Authentication failed', description: msg, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-md py-12">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Developer Console</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in with an API key to manage keys, usage, and runs.
        </p>
      </div>

      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={mode === 'login' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setMode('login')}
              className="flex-1"
            >
              Sign in
            </Button>
            <Button
              type="button"
              variant={mode === 'register' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setMode('register')}
              className="flex-1"
            >
              Create account
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            {mode === 'login' ? (
              <div className="space-y-1.5">
                <Label htmlFor="dev-api-key" className="text-xs">
                  API Key
                </Label>
                <Input
                  id="dev-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="ap_sk_..."
                  autoComplete="off"
                  required
                  autoFocus
                />
                <p className="text-[11px] text-muted-foreground">
                  Don&apos;t have a key? Switch to &ldquo;Create account&rdquo; to generate one.
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="dev-name" className="text-xs">
                    Name
                  </Label>
                  <Input
                    id="dev-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jordan Doe"
                    autoComplete="name"
                    required
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dev-email" className="text-xs">
                    Email
                  </Label>
                  <Input
                    id="dev-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.dev"
                    autoComplete="email"
                    required
                  />
                </div>
              </>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  {mode === 'login' ? 'Sign in' : 'Create developer account'}
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-[11px] text-muted-foreground">
        The developer console uses a separate API-key-based identity from your Apical
        account. <Link href="/docs#authentication" className="text-brand hover:underline">Learn more →</Link>
      </p>
    </div>
  )
}

// ─── Console (authenticated) ─────────────────────────────────────────────────

function Console({
  account,
  onAccountChanged,
}: {
  account: DevAccount
  onAccountChanged: () => Promise<boolean>
}) {
  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="flex flex-col gap-4 rounded-xl border border-border/60 bg-gradient-to-br from-primary/10 via-background to-background p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-foreground">
            <User className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{account.name}</h1>
            <p className="text-sm text-muted-foreground">{account.email}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="secondary" className="capitalize">
            {account.plan} plan
          </Badge>
          <Badge variant="outline">
            Balance: ${(account.balanceCents / 100).toFixed(2)}
          </Badge>
          <Badge variant="default" className="capitalize">
            {account.status}
          </Badge>
        </div>
      </div>

      <Tabs defaultValue="keys" className="space-y-4">
        <TabsList>
          <TabsTrigger value="keys">
            <KeyRound className="mr-1.5 h-3.5 w-3.5" />
            API Keys
          </TabsTrigger>
          <TabsTrigger value="usage">
            <Activity className="mr-1.5 h-3.5 w-3.5" />
            Usage
          </TabsTrigger>
          <TabsTrigger value="run">
            <Rocket className="mr-1.5 h-3.5 w-3.5" />
            Run Agent
          </TabsTrigger>
        </TabsList>

        <TabsContent value="keys" className="space-y-4">
          <KeysPanel />
        </TabsContent>
        <TabsContent value="usage" className="space-y-4">
          <UsagePanel />
        </TabsContent>
        <TabsContent value="run" className="space-y-4">
          <RunPanel />
        </TabsContent>
      </Tabs>

      {/* Hidden helper to keep onAccountChanged wired (refresh on mount) */}
      <span className="hidden" aria-hidden>
        <button onClick={() => void onAccountChanged()}>refresh</button>
      </span>
    </div>
  )
}

// ─── Keys panel ──────────────────────────────────────────────────────────────

function KeysPanel() {
  const { toast } = useToast()
  const [keys, setKeys] = React.useState<ApiKeyRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [newLabel, setNewLabel] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const [newlyCreatedKey, setNewlyCreatedKey] = React.useState<string | null>(null)

  const loadKeys = React.useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/dev/keys')
    if (res.ok) setKeys(await res.json())
    setLoading(false)
  }, [])

  React.useEffect(() => {
    void loadKeys()
  }, [loadKeys])

  const createKey = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    try {
      const res = await fetch('/api/dev/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newLabel || 'Untitled' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not create key')
      setNewlyCreatedKey(data.raw)
      setNewLabel('')
      toast({
        title: 'API key created',
        description: 'Copy it now — you won\'t see it again.',
      })
      await loadKeys()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed'
      toast({ title: 'Failed to create key', description: msg, variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const revokeKey = async (id: string, label: string) => {
    if (!confirm(`Revoke key "${label}"? This cannot be undone.`)) return
    const res = await fetch(`/api/dev/keys/${id}`, { method: 'DELETE' })
    if (res.ok) {
      toast({ title: 'Key revoked', description: `"${label}" can no longer authenticate.` })
      await loadKeys()
    } else {
      toast({ title: 'Failed to revoke', variant: 'destructive' })
    }
  }

  return (
    <>
      {newlyCreatedKey && (
        <Card className="border-border bg-muted">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4 text-brand" />
              Your new API key
            </CardTitle>
            <CardDescription>
              Copy this now — it will not be shown again.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <code className="block w-full break-all rounded-md border border-border bg-background px-3 py-2 font-mono text-sm">
              {newlyCreatedKey}
            </code>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(newlyCreatedKey)
                  toast({ title: 'Copied to clipboard' })
                }}
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                Copy
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setNewlyCreatedKey(null)}
              >
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create a new key</CardTitle>
          <CardDescription>
            Each key gets its own label so you can rotate or revoke them independently.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={createKey} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="key-label" className="text-xs">
                Label
              </Label>
              <Input
                id="key-label"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Cursor, CI, Local dev"
                maxLength={60}
              />
            </div>
            <Button type="submit" disabled={creating}>
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Plus className="mr-1.5 h-4 w-4" />
                  Create key
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your API keys</CardTitle>
          <CardDescription>{keys.length} key(s) on this account.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : keys.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No API keys yet. Create one above to get started.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.label}</TableCell>
                    <TableCell className="font-mono text-xs">{k.prefix}…</TableCell>
                    <TableCell>
                      <Badge
                        variant={k.status === 'active' ? 'default' : 'secondary'}
                        className="capitalize"
                      >
                        {k.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {k.lastUsedAt
                        ? `${new Date(k.lastUsedAt).toLocaleDateString()} · ${k.lastUsedFrom ?? '—'}`
                        : 'Never'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(k.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => revokeKey(k.id, k.label)}
                        disabled={k.status === 'revoked'}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  )
}

// ─── Usage panel ─────────────────────────────────────────────────────────────

function UsagePanel() {
  const { toast } = useToast()
  const [usage, setUsage] = React.useState<UsageStats | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [days, setDays] = React.useState(30)

  React.useEffect(() => {
    ;(async () => {
      setLoading(true)
      const res = await fetch(`/api/dev/usage?days=${days}`)
      if (res.ok) {
        setUsage(await res.json())
      } else {
        toast({
          title: 'Failed to load usage',
          variant: 'destructive',
        })
      }
      setLoading(false)
    })()
  }, [days, toast])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading usage…
      </div>
    )
  }

  if (!usage) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No usage data available.
        </CardContent>
      </Card>
    )
  }

  const maxCalls = Math.max(1, ...usage.callsByDay.map((d) => d.calls))

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h3 className="text-base font-semibold">Last {days} days</h3>
          <p className="text-xs text-muted-foreground">
            Aggregated from your audit log across all API keys.
          </p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
          <option value={365}>1 year</option>
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total calls" value={usage.totalCalls.toLocaleString()} />
        <StatCard
          label="Total cost"
          value={`$${(usage.totalCostCents / 100).toFixed(2)}`}
        />
        <StatCard
          label="Runs triggered"
          value={usage.runsTriggered.toLocaleString()}
        />
        <StatCard label="Success rate" value={`${usage.successRate}%`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Calls per day</CardTitle>
          <CardDescription>
            Bar chart of API call volume over the selected window.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {usage.callsByDay.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No calls in this window.
            </p>
          ) : (
            <div className="flex h-40 items-end gap-1 overflow-x-auto">
              {usage.callsByDay.map((d) => (
                <div
                  key={d.date}
                  className="group relative flex h-full flex-1 min-w-[6px] flex-col justify-end"
                  title={`${d.date}: ${d.calls} calls`}
                >
                  <div
                    className="w-full rounded-t bg-primary/70 transition-colors group-hover:bg-primary"
                    style={{ height: `${(d.calls / maxCalls) * 100}%`, minHeight: d.calls > 0 ? '2px' : '0' }}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Calls by action</CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(usage.callsByAction).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No actions recorded.
            </p>
          ) : (
            <div className="space-y-2">
              {Object.entries(usage.callsByAction)
                .sort((a, b) => b[1] - a[1])
                .map(([action, count]) => (
                  <div
                    key={action}
                    className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2 text-sm"
                  >
                    <code className="font-mono text-xs">{action}</code>
                    <Badge variant="secondary">{count}</Badge>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-border/60">
      <CardContent className="py-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  )
}

// ─── Run panel ───────────────────────────────────────────────────────────────

function RunPanel() {
  const { toast } = useToast()
  const [agents, setAgents] = React.useState<AgentRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [selected, setSelected] = React.useState('')
  const [running, setRunning] = React.useState(false)
  const [lastRunId, setLastRunId] = React.useState<string | null>(null)

  React.useEffect(() => {
    ;(async () => {
      setLoading(true)
      const res = await fetch('/api/dev/agents')
      if (res.ok) {
        const rows = (await res.json()) as AgentRow[]
        setAgents(rows)
        if (rows.length > 0) setSelected(rows[0].id)
      }
      setLoading(false)
    })()
  }, [])

  const run = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selected) return
    setRunning(true)
    try {
      const res = await fetch('/api/dev/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: selected }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Run failed')
      }
      setLastRunId(data.runId)
      toast({
        title: 'Run started',
        description: `Run ID: ${data.runId}`,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed'
      toast({ title: 'Run failed', description: msg, variant: 'destructive' })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trigger an agent run</CardTitle>
          <CardDescription>
            Runs cost 3¢ each, deducted from your balance. Progress streams live via the
            relay.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading agents…
            </div>
          ) : agents.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No agents in your workspace yet. Deploy one via the MCP server or the
              dashboard.
            </p>
          ) : (
            <form onSubmit={run} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="agent-select" className="text-xs">
                  Agent
                </Label>
                <select
                  id="agent-select"
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={running || !selected}>
                {running ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    Starting…
                  </>
                ) : (
                  <>
                    <Rocket className="mr-1.5 h-4 w-4" />
                    Run agent
                  </>
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {lastRunId && (
        <Card className="border-border bg-muted">
          <CardHeader>
            <CardTitle className="text-base">Run started</CardTitle>
            <CardDescription>
              The run is executing. Track progress in the dashboard or via the relay.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <code className="block w-full break-all rounded-md border border-border bg-background px-3 py-2 font-mono text-xs">
              {lastRunId}
            </code>
            <Separator className="my-3" />
            <p className="text-xs text-muted-foreground">
              <code className="font-mono">GET /api/runs/{lastRunId}</code> — fetch status.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
