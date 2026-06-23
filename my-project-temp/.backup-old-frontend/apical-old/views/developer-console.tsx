'use client'

// Apical Developer Console — the hidden technical interface.
//
// A left tab rail (vertical on md+, horizontal scroll on mobile) switches
// between six tabs: Overview, Integrations, Schema, Employees, Runs, Vault.
// Tabs 4/5/6 reuse the existing fully-built views (WorkflowsView, RunsView,
// VaultView). Tabs 1/2/3 are new: a hero overview, the integration library
// browser (builtin / private / public), and the Automation File schema
// reference + live JSON editor + deploy.

import * as React from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { useAppStore, type DevTab } from '@/lib/store'
import {
  useStats,
  useRuns,
  useWorkflows,
  useIntegrations,
  useIntegrationLibrary,
  useInstallIntegration,
  usePublishIntegration,
  useCreateIntegration,
  useDevSchema,
  useImportEmployee,
  useCredentials,
} from '@/lib/queries'
import { WorkflowsView } from './workflows-view'
import { RunsView } from './runs-view'
import { VaultView } from './vault-view'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import { useToast } from '@/hooks/use-toast'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { STEP_KIND_META, formatDuration, relativeTime } from '@/lib/apical'
import type {
  Integration,
  IntegrationKind,
  IntegrationVisibility,
  Run,
  StepKind,
} from '@/lib/types'
import {
  LayoutDashboard,
  Library,
  FileJson,
  Users,
  Activity,
  Vault as VaultIcon,
  Plus,
  Plug,
  Wrench,
  Globe,
  Server,
  Download,
  Bot,
  Lock,
  Rocket,
  Sparkles,
  Brain,
  ShieldCheck,
  ArrowRight,
  Loader2,
  Copy,
  Check,
  Terminal,
  Boxes,
  KeyRound,
  CheckCircle2,
  AlertTriangle,
  Code2,
} from 'lucide-react'

// ----------------------------------------------------------------------------
// Tab rail config
// ----------------------------------------------------------------------------

const TABS: {
  key: DevTab
  label: string
  icon: React.ComponentType<{ className?: string }>
  description: string
}[] = [
  {
    key: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    description: 'Hero, quick stats, recent activity',
  },
  {
    key: 'library',
    label: 'Integrations',
    icon: Library,
    description: 'Browse builtin / private / public',
  },
  {
    key: 'schema',
    label: 'Schema',
    icon: FileJson,
    description: 'Automation File reference + deploy',
  },
  {
    key: 'employees',
    label: 'Employees',
    icon: Users,
    description: 'Workflows, technical view',
  },
  {
    key: 'runs',
    label: 'Runs',
    icon: Activity,
    description: 'Live execution traces',
  },
  {
    key: 'vault',
    label: 'Vault',
    icon: VaultIcon,
    description: 'Credentials & AI-auth',
  },
]

// Shared integration-kind metadata (badge colors + icons).
const KIND_META: Record<
  IntegrationKind,
  { label: string; badge: string; icon: React.ComponentType<{ className?: string }> }
> = {
  mcp: { label: 'MCP', badge: 'border-primary/40 bg-primary/15 text-primary', icon: Server },
  api: { label: 'API', badge: 'border-violet-500/40 bg-violet-500/15 text-violet-500', icon: FileJson },
  http: { label: 'HTTP', badge: 'border-amber-500/40 bg-amber-500/15 text-amber-500', icon: Globe },
}

const STATUS_DOT: Record<Integration['status'], string> = {
  connected: 'bg-emerald-500',
  error: 'bg-destructive',
  draft: 'bg-muted-foreground/40',
}

const CATEGORIES: { key: string; label: string }[] = [
  { key: 'files', label: 'Files' },
  { key: 'email', label: 'Email' },
  { key: 'database', label: 'Database' },
  { key: 'documents', label: 'Documents' },
  { key: 'messaging', label: 'Messaging' },
  { key: 'finance', label: 'Finance' },
  { key: 'general', label: 'General' },
]

// ----------------------------------------------------------------------------
// Shell — left tab rail + content area
// ----------------------------------------------------------------------------

export function DeveloperConsole() {
  const devTab = useAppStore((s) => s.devTab)
  const setDevTab = useAppStore((s) => s.setDevTab)

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col md:flex-row">
      {/* Tab rail */}
      <aside className="shrink-0 border-b border-border bg-card/30 md:border-b-0 md:border-r md:w-56 lg:w-60">
        {/* Mobile: horizontal scroll row */}
        <div className="flex gap-1 overflow-x-auto p-2 md:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((t) => {
            const Icon = t.icon
            const active = devTab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setDevTab(t.key)}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Desktop: vertical rail */}
        <nav className="hidden md:flex md:h-full md:flex-col md:gap-0.5 md:p-2.5">
          <div className="px-2.5 pb-2 pt-1">
            <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <Code2 className="h-3 w-3" />
              Developer
            </div>
          </div>
          {TABS.map((t) => {
            const Icon = t.icon
            const active = devTab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setDevTab(t.key)}
                className={cn(
                  'group flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                  active
                    ? 'bg-primary/10 text-foreground ring-1 ring-primary/20'
                    : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
                )}
              >
                <Icon
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0',
                    active ? 'text-primary' : 'text-muted-foreground/70 group-hover:text-foreground',
                  )}
                />
                <div className="min-w-0">
                  <div className="text-xs font-medium leading-tight">{t.label}</div>
                  <div className="mt-0.5 line-clamp-1 text-[10px] leading-tight text-muted-foreground">
                    {t.description}
                  </div>
                </div>
              </button>
            )
          })}
          <div className="mt-auto px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              API · MCP · Socket relay
            </div>
          </div>
        </nav>
      </aside>

      {/* Content */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        {devTab === 'overview' && <OverviewTab />}
        {devTab === 'library' && <LibraryTab />}
        {devTab === 'schema' && <SchemaTab />}
        {devTab === 'employees' && <WorkflowsView />}
        {devTab === 'runs' && <RunsView />}
        {devTab === 'vault' && <VaultView />}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Shared small components
// ----------------------------------------------------------------------------

function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  onClick,
}: {
  label: string
  value: React.ReactNode
  sub?: string
  icon: React.ComponentType<{ className?: string }>
  accent?: string
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'rounded-xl border border-border bg-card p-3.5 text-left transition-colors',
        onClick && 'hover:border-primary/40 hover:bg-accent/30',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div className="mt-1 truncate text-xl font-semibold tabular-nums">{value}</div>
          {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
        </div>
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
            accent ?? 'bg-muted text-muted-foreground',
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </button>
  )
}

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = React.useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable — silently no-op
    }
  }
  return (
    <button
      onClick={copy}
      className={cn(
        'rounded-md border border-border bg-card p-1 text-muted-foreground transition-colors hover:text-foreground',
        className,
      )}
      aria-label="Copy"
      type="button"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

// ----------------------------------------------------------------------------
// Tab 1 — Overview
// ----------------------------------------------------------------------------

function OverviewTab() {
  const { data: stats, isLoading: statsLoading } = useStats()
  const { data: integrations } = useIntegrations()
  const { data: runs } = useRuns(5)
  const { data: creds } = useCredentials()
  const { data: workflows } = useWorkflows()
  const setDevTab = useAppStore((s) => s.setDevTab)

  const intCounts = React.useMemo(() => {
    const list = integrations ?? []
    return {
      builtin: list.filter((i) => i.source === 'builtin').length,
      private: list.filter((i) => i.source === 'private').length,
      public: list.filter((i) => i.source === 'public').length,
    }
  }, [integrations])

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:px-6">
      {/* Hero */}
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="relative overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-5">
          <div className="bg-dots absolute inset-0 opacity-20" />
          <div className="relative">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-primary">
              <Terminal className="h-3.5 w-3.5" />
              Developer console
            </div>
            <h1 className="mt-2 text-xl font-semibold leading-tight md:text-2xl">
              Build, deploy, and inspect automations.
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
              Everything here is also available via the REST API and the Apical MCP server. Draft an
              Automation File, deploy it, and watch runs execute step-by-step.
            </p>
          </div>
        </Card>
      </motion.div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Employees"
          value={workflows?.length ?? '—'}
          icon={Users}
          accent="bg-primary/10 text-primary"
          onClick={() => setDevTab('employees')}
        />
        <StatTile
          label="Runs today"
          value={statsLoading ? '—' : stats?.runsToday ?? 0}
          sub={`${stats?.itemsThisWeek ?? 0} items this week`}
          icon={Activity}
          accent="bg-emerald-500/10 text-emerald-500"
          onClick={() => setDevTab('runs')}
        />
        <StatTile
          label="Integrations"
          value={
            intCounts.builtin + intCounts.private + intCounts.public > 0
              ? `${intCounts.builtin}·${intCounts.private}·${intCounts.public}`
              : '—'
          }
          sub="builtin · private · public"
          icon={Plug}
          accent="bg-violet-500/10 text-violet-500"
          onClick={() => setDevTab('library')}
        />
        <StatTile
          label="Credentials"
          value={creds?.length ?? '—'}
          icon={KeyRound}
          accent="bg-amber-500/10 text-amber-500"
          onClick={() => setDevTab('vault')}
        />
      </div>

      {/* Three cards */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <ApiDeployCard />
        <McpServerCard />
        <SchemaLinkCard onClick={() => setDevTab('schema')} />
      </div>

      {/* Recent activity */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Activity className="h-4 w-4 text-muted-foreground" />
            Recent activity
          </h3>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-[11px]"
            onClick={() => setDevTab('runs')}
          >
            All runs
            <ArrowRight className="h-3 w-3" />
          </Button>
        </div>
        {statsLoading || !runs || runs.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">No runs yet.</p>
        ) : (
          <div className="space-y-1">
            {runs.slice(0, 5).map((r) => (
              <RecentRunRow key={r.id} run={r} />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function RecentRunRow({ run }: { run: Run }) {
  const selectRun = useAppStore((s) => s.selectRun)
  const setDevTab = useAppStore((s) => s.setDevTab)
  const Icon =
    run.status === 'completed'
      ? CheckCircle2
      : run.status === 'running'
        ? Loader2
        : run.status === 'failed'
          ? AlertTriangle
          : run.status === 'awaiting_gate'
            ? ShieldCheck
            : Activity
  const color =
    run.status === 'completed'
      ? 'text-emerald-500'
      : run.status === 'running'
        ? 'text-primary'
        : run.status === 'failed'
          ? 'text-destructive'
          : run.status === 'awaiting_gate'
            ? 'text-gate-foreground'
            : 'text-muted-foreground'
  return (
    <button
      onClick={() => {
        selectRun(run.id)
        setDevTab('runs')
      }}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent/40"
    >
      <Icon className={cn('h-3.5 w-3.5 shrink-0', color, run.status === 'running' && 'animate-spin')} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">{run.workflowName}</div>
        <div className="text-[10px] text-muted-foreground">
          {run.itemsProcessed} items · {run.automaticCount} auto
          {run.flaggedCount > 0 && ` · ${run.flaggedCount} flagged`}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[10px] text-muted-foreground">{relativeTime(run.startedAt)}</div>
        <div className="font-mono text-[10px] text-muted-foreground/70">
          {run.status === 'running' ? 'in progress' : formatDuration(run.durationMs)}
        </div>
      </div>
    </button>
  )
}

function ApiDeployCard() {
  const curl = `curl -X POST /api/employees/import \\
  -H 'Content-Type: application/json' \\
  -d "$(jq -nc --arg f "$(cat pat.json)" '{json:$f}')"`
  return (
    <Card className="flex flex-col p-4">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
          <Rocket className="h-3.5 w-3.5" />
        </div>
        <h3 className="text-sm font-medium">Deploy via API</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        POST an Automation File to{' '}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">/api/employees/import</code>{' '}
        to hire. Body is{' '}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">{`{ json: string }`}</code>.
      </p>
      <div className="relative mt-3 rounded-lg border border-border bg-background/60 p-2.5">
        <pre className="overflow-x-auto font-mono text-[10.5px] leading-relaxed text-foreground/90">
          {curl}
        </pre>
        <CopyButton text={curl} className="absolute right-1.5 top-1.5" />
      </div>
      <div className="mt-auto pt-3 text-[10px] text-muted-foreground">
        Returns{' '}
        <code className="font-mono">{`{ employee, integrationsCreated, credentialsCreated }`}</code>.
      </div>
    </Card>
  )
}

function McpServerCard() {
  const endpoint = 'http://localhost:3000/mcp'
  return (
    <Card className="flex flex-col p-4">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
          <Plug className="h-3.5 w-3.5" />
        </div>
        <h3 className="text-sm font-medium">MCP server</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Point Cursor or any MCP-aware agent at Apical. It can call{' '}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">apical.deploy</code> with a
        parsed Automation File to hire an employee directly.
      </p>
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between rounded-lg border border-border bg-background/60 px-2.5 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <Terminal className="h-3 w-3 shrink-0 text-muted-foreground" />
            <code className="truncate font-mono text-[11px]">{endpoint}</code>
          </div>
          <CopyButton text={endpoint} />
        </div>
        <div className="flex items-center justify-between rounded-lg border border-dashed border-border bg-background/40 px-2.5 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <Boxes className="h-3 w-3 shrink-0 text-muted-foreground" />
            <code className="truncate font-mono text-[11px] text-muted-foreground">stdio://apical-mcp</code>
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground">local</span>
        </div>
      </div>
      <div className="mt-auto pt-3 text-[10px] text-muted-foreground">
        Tools:{' '}
        <code className="font-mono">apical.deploy</code>,{' '}
        <code className="font-mono">apical.run</code>,{' '}
        <code className="font-mono">apical.list</code>.
      </div>
    </Card>
  )
}

function SchemaLinkCard({ onClick }: { onClick: () => void }) {
  return (
    <Card className="flex flex-col p-4">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
          <FileJson className="h-3.5 w-3.5" />
        </div>
        <h3 className="text-sm font-medium">Automation File format</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        A single JSON fully describes a hire: department, title, inline integrations, credentials, and
        a tool/reason/gate workflow.
      </p>
      <div className="mt-3 space-y-0.5 rounded-lg border border-border bg-background/60 p-2.5 font-mono text-[10.5px] leading-relaxed text-foreground/90">
        <div>
          <span className="text-reason">name</span>
          <span className="text-muted-foreground">: </span>
          <span className="text-emerald-500">&quot;Pat&quot;</span>
        </div>
        <div>
          <span className="text-reason">title</span>
          <span className="text-muted-foreground">: </span>
          <span className="text-emerald-500">&quot;Filing Clerk&quot;</span>
        </div>
        <div>
          <span className="text-reason">department</span>
          <span className="text-muted-foreground">: </span>
          <span className="text-emerald-500">&quot;filing&quot;</span>
        </div>
        <div>
          <span className="text-reason">steps</span>
          <span className="text-muted-foreground">: [ … ]</span>
        </div>
      </div>
      <div className="mt-auto pt-3">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onClick}>
          <FileJson className="h-3.5 w-3.5" />
          Open schema reference
          <ArrowRight className="h-3 w-3" />
        </Button>
      </div>
    </Card>
  )
}

// ----------------------------------------------------------------------------
// Tab 2 — Integrations Library
// ----------------------------------------------------------------------------

type LibFilter = 'builtin' | 'private' | 'public'

const LIB_FILTERS: {
  key: LibFilter
  label: string
  icon: React.ComponentType<{ className?: string }>
  description: string
  emptyHint: string
}[] = [
  {
    key: 'builtin',
    label: 'Built-in',
    icon: Boxes,
    description: 'Ship with the product. Always available — no install needed.',
    emptyHint: 'Built-in integrations ship with Apical.',
  },
  {
    key: 'private',
    label: 'My private',
    icon: Lock,
    description: 'Ones you added. Only visible to you. Publish to share with the community.',
    emptyHint: 'Add your own — an MCP server, OpenAPI spec, or raw HTTP endpoint.',
  },
  {
    key: 'public',
    label: 'Public library',
    icon: Globe,
    description: 'Community-contributed. Install one with a click — clones into your private library.',
    emptyHint: 'No community integrations yet. Publish one of yours to fill the library.',
  },
]

function LibraryTab() {
  const [filter, setFilter] = React.useState<LibFilter>('builtin')
  const { data, isLoading } = useIntegrationLibrary(filter)
  const { data: all } = useIntegrations()

  const counts = React.useMemo(() => {
    const list = all ?? []
    return {
      builtin: list.filter((i) => i.source === 'builtin').length,
      private: list.filter((i) => i.source === 'private').length,
      public: list.filter((i) => i.source === 'public').length,
    }
  }, [all])

  const currentFilter = LIB_FILTERS.find((f) => f.key === filter)!

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:px-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-base font-semibold">
            <Library className="h-4 w-4 text-muted-foreground" />
            Integrations
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Built-in ship with the product · add your own privately · contribute to the public library
            · install from the community.
          </p>
        </div>
        <AddIntegrationDialog />
      </div>

      {/* Sub-tab filters */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-card/40 p-1">
        {LIB_FILTERS.map((f) => {
          const Icon = f.icon
          const active = filter === f.key
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                active
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {f.label}
              <span
                className={cn(
                  'rounded px-1 font-mono text-[10px] tabular-nums',
                  active ? 'bg-primary-foreground/20' : 'bg-muted',
                )}
              >
                {counts[f.key]}
              </span>
            </button>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground">{currentFilter.description}</p>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Plug className="h-5 w-5" />
          </div>
          <h3 className="text-sm font-medium">No {filter} integrations</h3>
          <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
            {currentFilter.emptyHint}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((int, i) => (
            <LibraryCard key={int.id} int={int} delay={i * 0.04} filter={filter} />
          ))}
        </div>
      )}
    </div>
  )
}

function LibraryCard({ int, delay, filter }: { int: Integration; delay: number; filter: LibFilter }) {
  const install = useInstallIntegration()
  const { toast } = useToast()
  const kindMeta = KIND_META[int.kind]
  const KindIcon = kindMeta.icon

  const handleInstall = async () => {
    try {
      await install.mutateAsync(int.id)
      toast({
        title: 'Installed',
        description: `“${int.name}” is now in your private library.`,
      })
    } catch (e) {
      toast({
        title: 'Install failed',
        description: (e as Error).message,
        variant: 'destructive',
      })
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <Card className="flex h-full flex-col overflow-hidden p-0">
        <div className="flex-1 p-4">
          <div className="flex items-start gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
              <KindIcon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-medium">{int.name}</span>
                <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px] font-medium', kindMeta.badge)}>
                  {kindMeta.label}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[int.status])} />
                  {int.status}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{int.description}</p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="gap-1 text-[10px]">
              <Wrench className="h-2.5 w-2.5" />
              {int.tools.length} {int.tools.length === 1 ? 'tool' : 'tools'}
            </Badge>
            <Badge variant="outline" className="text-[10px] capitalize">
              {int.category}
            </Badge>
            {filter === 'public' && int.authorLabel && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <Bot className="h-2.5 w-2.5" />
                {int.authorLabel}
              </Badge>
            )}
            {filter === 'public' && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <Download className="h-2.5 w-2.5" />
                {int.installs} {int.installs === 1 ? 'install' : 'installs'}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/20 px-4 py-2.5">
          {filter === 'builtin' && (
            <span className="text-[10px] text-muted-foreground">Always available</span>
          )}
          {filter === 'private' && (
            <>
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <Lock className="h-2.5 w-2.5" />
                Private
              </span>
              <PublishButton int={int} />
            </>
          )}
          {filter === 'public' && (
            <>
              <span className="text-[10px] text-muted-foreground">Community</span>
              <Button
                size="sm"
                className="h-7 gap-1.5 text-[11px]"
                onClick={handleInstall}
                disabled={install.isPending}
              >
                {install.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Download className="h-3 w-3" />
                )}
                Install
              </Button>
            </>
          )}
        </div>
      </Card>
    </motion.div>
  )
}

function PublishButton({ int }: { int: Integration }) {
  const [open, setOpen] = React.useState(false)
  const [author, setAuthor] = React.useState('')
  const publish = usePublishIntegration()
  const { toast } = useToast()

  const submit = async () => {
    try {
      const label = author.trim() || 'community'
      await publish.mutateAsync({ id: int.id, authorLabel: label })
      toast({
        title: 'Published',
        description: `“${int.name}” is now in the public library.`,
      })
      setOpen(false)
      setAuthor('')
    } catch (e) {
      toast({
        title: 'Publish failed',
        description: (e as Error).message,
        variant: 'destructive',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[11px]">
          <Globe className="h-3 w-3" />
          Publish
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Publish “{int.name}” to the public library
          </DialogTitle>
          <DialogDescription>
            Others will be able to install it. Your private copy stays intact. Leave author blank to
            publish as “community”.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="pub-author">Author label (optional)</Label>
          <Input
            id="pub-author"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="@you, community, …"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={publish.isPending} className="gap-1.5">
            {publish.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Globe className="h-3.5 w-3.5" />
            )}
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddIntegrationDialog() {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [kind, setKind] = React.useState<IntegrationKind>('mcp')
  const [category, setCategory] = React.useState('general')
  const [url, setUrl] = React.useState('')
  const [specUrl, setSpecUrl] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [visibility, setVisibility] = React.useState<IntegrationVisibility>('private')
  const [author, setAuthor] = React.useState('')
  const create = useCreateIntegration()
  const { toast } = useToast()

  const reset = () => {
    setName('')
    setKind('mcp')
    setCategory('general')
    setUrl('')
    setSpecUrl('')
    setDescription('')
    setVisibility('private')
    setAuthor('')
  }

  const submit = async () => {
    const n = name.trim()
    if (!n) {
      toast({ title: 'Name required', variant: 'destructive' })
      return
    }
    try {
      await create.mutateAsync({
        name: n,
        kind,
        category,
        url: kind === 'mcp' || kind === 'http' ? url.trim() || undefined : undefined,
        specUrl: kind === 'api' ? specUrl.trim() || undefined : undefined,
        description: description.trim() || undefined,
        source: 'private',
        visibility,
        authorLabel: visibility === 'public' ? author.trim() || 'community' : undefined,
      })
      toast({
        title: 'Integration added',
        description: `“${n}” added to your ${visibility} library.`,
      })
      setOpen(false)
      reset()
    } catch (e) {
      toast({
        title: 'Could not add integration',
        description: (e as Error).message,
        variant: 'destructive',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add integration
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add integration</DialogTitle>
          <DialogDescription>
            MCP servers and OpenAPI specs expose their tools automatically. Raw HTTP is for anything
            else.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="lib-name">Name</Label>
            <Input
              id="lib-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. HubSpot, Acme CRM"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Kind</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as IntegrationKind)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mcp">MCP</SelectItem>
                  <SelectItem value="api">API (OpenAPI)</SelectItem>
                  <SelectItem value="http">Raw HTTP</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {kind === 'mcp' && (
            <div className="space-y-1.5">
              <Label htmlFor="lib-url">MCP server URL</Label>
              <Input
                id="lib-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="stdio://my-mcp or http://localhost:8080"
                className="font-mono text-xs"
              />
            </div>
          )}
          {kind === 'api' && (
            <div className="space-y-1.5">
              <Label htmlFor="lib-spec">OpenAPI spec URL</Label>
              <Input
                id="lib-spec"
                value={specUrl}
                onChange={(e) => setSpecUrl(e.target.value)}
                placeholder="https://api.example.com/openapi.json"
                className="font-mono text-xs"
              />
            </div>
          )}
          {kind === 'http' && (
            <div className="space-y-1.5">
              <Label htmlFor="lib-endpoint">Endpoint URL</Label>
              <Input
                id="lib-endpoint"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://api.example.com"
                className="font-mono text-xs"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="lib-desc">Description (optional)</Label>
            <Input
              id="lib-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this integration do?"
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-xs font-medium">Publish to public library</div>
              <div className="text-[10px] text-muted-foreground">
                Others can install it. Off = private to you.
              </div>
            </div>
            <Switch
              checked={visibility === 'public'}
              onCheckedChange={(c) => setVisibility(c ? 'public' : 'private')}
              aria-label="Publish to public library"
            />
          </div>
          {visibility === 'public' && (
            <div className="space-y-1.5">
              <Label htmlFor="lib-author">Author label</Label>
              <Input
                id="lib-author"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="@you, community, …"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending} className="gap-1.5">
            {create.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ----------------------------------------------------------------------------
// Tab 3 — Schema (Automation File JSON reference + live editor)
// ----------------------------------------------------------------------------

interface SchemaField {
  type: string
  required?: boolean
  description: string
  fields?: Record<string, string>
  itemFields?: Record<string, string>
}
interface SchemaDoc {
  format?: string
  version?: number
  description: string
  fields: Record<string, SchemaField>
  example: unknown
}

function SchemaTab() {
  const { data, isLoading } = useDevSchema()
  const importEmp = useImportEmployee()
  const { toast } = useToast()
  const setDevTab = useAppStore((s) => s.setDevTab)
  const selectWorkflow = useAppStore((s) => s.selectWorkflow)
  const [editorValue, setEditorValue] = React.useState('')
  const [editorErr, setEditorErr] = React.useState<string | null>(null)
  const [editorInfo, setEditorInfo] = React.useState<string | null>(null)

  const doc = data as SchemaDoc | undefined
  const exampleJson = doc ? JSON.stringify(doc.example, null, 2) : ''

  // Initialize editor with the example once loaded.
  React.useEffect(() => {
    if (exampleJson && !editorValue) setEditorValue(exampleJson)
  }, [exampleJson, editorValue])

  const goToDevice = (employeeId: string, name: string, title?: string | null) => {
    selectWorkflow(employeeId)
    setDevTab('employees')
    toast({
      title: 'Employee deployed',
      description: `${name}${title ? ` — ${title}` : ''} is now on staff.`,
    })
  }

  const deployExample = async () => {
    if (!exampleJson) return
    try {
      const r = await importEmp.mutateAsync({ json: exampleJson })
      goToDevice(r.employee.id, r.employee.name, r.employee.title)
    } catch (e) {
      toast({
        title: 'Deploy failed',
        description: (e as Error).message,
        variant: 'destructive',
      })
    }
  }

  const deployEditor = async () => {
    setEditorErr(null)
    setEditorInfo(null)
    const v = editorValue.trim()
    if (!v) {
      setEditorErr('Paste an Automation File JSON first.')
      return
    }
    // Validate JSON locally first for a friendly error.
    try {
      JSON.parse(v)
    } catch (e) {
      setEditorErr(`Invalid JSON: ${(e as Error).message}`)
      return
    }
    try {
      const r = await importEmp.mutateAsync({ json: v })
      setEditorInfo(
        `✓ ${r.employee.name}${r.employee.title ? ` — ${r.employee.title}` : ''} hired. ${r.integrationsCreated} integration(s), ${r.credentialsCreated} credential(s) installed.`,
      )
      goToDevice(r.employee.id, r.employee.name, r.employee.title)
    } catch (e) {
      setEditorErr((e as Error).message)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:px-6">
      {/* Hero */}
      <Card className="relative overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-5">
        <div className="bg-dots absolute inset-0 opacity-20" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-primary">
              <FileJson className="h-3.5 w-3.5" />
              Automation File · v{doc?.version ?? 1}
            </div>
            <h1 className="mt-2 text-xl font-semibold leading-tight md:text-2xl">
              The single-JSON hire format.
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
              {doc?.description ?? 'Loading…'}
            </p>
          </div>
          <Button
            onClick={deployExample}
            disabled={isLoading || importEmp.isPending || !exampleJson}
            className="shrink-0 gap-1.5"
          >
            {importEmp.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Rocket className="h-3.5 w-3.5" />
            )}
            Deploy example
          </Button>
        </div>
      </Card>

      {isLoading || !doc ? (
        <div className="space-y-4">
          <Skeleton className="h-44 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      ) : (
        <>
          {/* Fields table */}
          <Card className="p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Code2 className="h-4 w-4 text-muted-foreground" />
              Fields
            </h3>
            <FieldsTable fields={doc.fields} />
          </Card>

          {/* Step kinds + data passing */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <StepKindsCard />
            <DataPassingCard />
          </div>

          {/* Example JSON */}
          <Card className="overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <FileJson className="h-4 w-4 text-muted-foreground" />
                Example
              </h3>
              <span className="font-mono text-[10px] text-muted-foreground">pat.json · Filing Clerk</span>
            </div>
            <div className="max-h-96 overflow-auto bg-[#1e1e1e]">
              <SyntaxHighlighter
                language="json"
                style={vscDarkPlus}
                customStyle={{
                  margin: 0,
                  padding: '1rem',
                  background: 'transparent',
                  fontSize: '11.5px',
                  lineHeight: 1.55,
                }}
                showLineNumbers
              >
                {exampleJson}
              </SyntaxHighlighter>
            </div>
          </Card>

          {/* Live editor */}
          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-medium">
                  <Terminal className="h-4 w-4 text-muted-foreground" />
                  Live editor
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Edit and deploy. Paste your own Automation File to test it.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-[11px]"
                  onClick={() => setEditorValue(exampleJson)}
                  disabled={!exampleJson}
                >
                  Reset to example
                </Button>
                <Button
                  size="sm"
                  className="h-7 gap-1.5 text-[11px]"
                  onClick={deployEditor}
                  disabled={importEmp.isPending}
                >
                  {importEmp.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Rocket className="h-3 w-3" />
                  )}
                  Deploy
                </Button>
              </div>
            </div>
            <Textarea
              value={editorValue}
              onChange={(e) => {
                setEditorValue(e.target.value)
                setEditorErr(null)
                setEditorInfo(null)
              }}
              className="min-h-[280px] font-mono text-xs"
              placeholder="Paste an Automation File JSON here…"
              spellCheck={false}
            />
            {editorErr && (
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <code className="break-words font-mono">{editorErr}</code>
              </div>
            )}
            {editorInfo && (
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-xs text-emerald-500">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{editorInfo}</span>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

function FieldsTable({ fields }: { fields: Record<string, SchemaField> }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[26%]">Field</TableHead>
            <TableHead className="w-[34%]">Type</TableHead>
            <TableHead>Description</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Object.entries(fields).map(([name, f]) => (
            <React.Fragment key={name}>
              <TableRow>
                <TableCell className="align-top">
                  <code className="font-mono text-xs text-foreground">{name}</code>
                  {f.required && (
                    <span className="ml-1.5 rounded bg-primary/15 px-1 py-0.5 text-[9px] font-medium uppercase text-primary">
                      required
                    </span>
                  )}
                </TableCell>
                <TableCell className="whitespace-normal align-top font-mono text-[11px] text-muted-foreground">
                  {f.type}
                </TableCell>
                <TableCell className="align-top text-xs text-muted-foreground">{f.description}</TableCell>
              </TableRow>
              {f.fields && (
                <TableRow className="bg-muted/20 hover:bg-muted/20">
                  <TableCell colSpan={3} className="py-2 pl-8">
                    <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
                      {name} · fields
                    </div>
                    <SubFieldsTable fields={f.fields} />
                  </TableCell>
                </TableRow>
              )}
              {f.itemFields && (
                <TableRow className="bg-muted/20 hover:bg-muted/20">
                  <TableCell colSpan={3} className="py-2 pl-8">
                    <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
                      {name}[] · item fields
                    </div>
                    <SubFieldsTable fields={f.itemFields} />
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function SubFieldsTable({ fields }: { fields: Record<string, string> }) {
  return (
    <div className="space-y-1">
      {Object.entries(fields).map(([k, v]) => (
        <div key={k} className="grid grid-cols-[minmax(120px,32%)_1fr] gap-2 text-[11px]">
          <code className="font-mono text-foreground">{k}</code>
          <span className="font-mono text-muted-foreground">{v}</span>
        </div>
      ))}
    </div>
  )
}

function StepKindsCard() {
  const kinds: StepKind[] = ['tool', 'reason', 'gate']
  return (
    <Card className="p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
        <Boxes className="h-4 w-4 text-muted-foreground" />
        Step kinds
      </h3>
      <div className="space-y-2.5">
        {kinds.map((k) => {
          const meta = STEP_KIND_META[k]
          return (
            <div key={k} className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-card/40 p-2.5">
              <div
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border font-mono text-[10px] font-semibold',
                  k === 'tool' && 'border-tool/40 bg-tool/30 text-tool-foreground',
                  k === 'reason' && 'border-reason/40 bg-reason/15 text-reason',
                  k === 'gate' && 'border-gate/40 bg-gate/15 text-gate-foreground',
                )}
              >
                {meta.short}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium">{meta.label}</div>
                <div className="text-[11px] leading-relaxed text-muted-foreground">{meta.description}</div>
              </div>
            </div>
          )
        })}
        <div className="flex items-start gap-2.5 rounded-lg border border-hardened/30 bg-hardened/5 p-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-hardened/40 bg-hardened/15 text-hardened">
            <Lock className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium">Hardened</div>
            <div className="text-[11px] leading-relaxed text-muted-foreground">
              A reason step that has resolved the same way ~10+ times, flipped to a deterministic tool
              rule. Same JSON, no AI, basically free.
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}

function DataPassingCard() {
  return (
    <Card className="p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
        Data passing
      </h3>
      <p className="text-xs text-muted-foreground">
        Reference any earlier step&apos;s output with{' '}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">{`{{stepId.field}}`}</code>.
        The runtime walks the path and inlines the value at execution time.
      </p>
      <div className="mt-3 space-y-1 rounded-lg border border-border bg-background/60 p-2.5 font-mono text-[11px] leading-relaxed">
        <div className="text-muted-foreground">{`// step s1 outputs { files: [...] }`}</div>
        <div>
          <span className="text-reason">inputs</span>
          <span className="text-muted-foreground">: </span>
          <span>{`{ file: '{{s1.files[]}}' }`}</span>
        </div>
        <div className="text-muted-foreground">{`// → resolved at runtime`}</div>
        <div>
          <span className="text-reason">inputs</span>
          <span className="text-muted-foreground">: </span>
          <span>{`{ file: ['invoice.pdf', 'receipt.pdf'] }`}</span>
        </div>
      </div>
      <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
        <div className="flex items-start gap-1.5">
          <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
          <code className="font-mono">{`{{s1.files[]}}`}</code>
          <span>— array spread</span>
        </div>
        <div className="flex items-start gap-1.5">
          <Brain className="mt-0.5 h-3 w-3 shrink-0 text-reason" />
          <code className="font-mono">{`{{s3.client}}`}</code>
          <span>— scalar field from a reason step</span>
        </div>
        <div className="flex items-start gap-1.5">
          <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-gate-foreground" />
          <code className="font-mono">{`{{s2.text}}`}</code>
          <span>— nested path supported</span>
        </div>
      </div>
    </Card>
  )
}
