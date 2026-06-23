'use client'

import * as React from 'react'
import { useIntegrations, useCreateIntegration } from '@/lib/queries'
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
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import {
  Plus,
  Plug,
  Wrench,
  ChevronDown,
  Globe,
  FileJson,
  Server,
  CircleDot,
  PlugZap,
} from 'lucide-react'
import type { Integration, IntegrationKind } from '@/lib/types'

// ----------------------------------------------------------------------------
// Maps
// ----------------------------------------------------------------------------

const KIND_META: Record<IntegrationKind, { label: string; badge: string; icon: React.ComponentType<{ className?: string }> }> = {
  mcp: { label: 'MCP', badge: 'border-primary/40 bg-primary/15 text-primary', icon: Server },
  api: { label: 'API', badge: 'border-violet-500/40 bg-violet-500/15 text-violet-500', icon: FileJson },
  http: { label: 'HTTP', badge: 'border-amber-500/40 bg-amber-500/15 text-amber-500', icon: Globe },
}

const COLOR_BORDER: Record<string, string> = {
  emerald: 'border-l-emerald-500',
  rose: 'border-l-rose-500',
  amber: 'border-l-amber-500',
  violet: 'border-l-violet-500',
  sky: 'border-l-sky-500',
  teal: 'border-l-teal-500',
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
// Add integration dialog
// ----------------------------------------------------------------------------

function AddIntegrationDialog() {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [kind, setKind] = React.useState<IntegrationKind>('mcp')
  const [category, setCategory] = React.useState('general')
  const [url, setUrl] = React.useState('')
  const [specUrl, setSpecUrl] = React.useState('')
  const create = useCreateIntegration()
  const { toast } = useToast()

  const reset = () => {
    setName('')
    setKind('mcp')
    setCategory('general')
    setUrl('')
    setSpecUrl('')
  }

  const submit = async () => {
    if (!name.trim()) {
      toast({ title: 'Name required', variant: 'destructive' })
      return
    }
    try {
      await create.mutateAsync({
        name: name.trim(),
        kind,
        category,
        url: kind === 'mcp' || kind === 'http' ? url.trim() || undefined : undefined,
        specUrl: kind === 'api' ? specUrl.trim() || undefined : undefined,
      })
      toast({ title: 'Integration added', description: `"${name.trim()}" is connected.` })
      setOpen(false)
      reset()
    } catch (e) {
      toast({ title: 'Could not add integration', description: (e as Error).message, variant: 'destructive' })
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add integration</DialogTitle>
          <DialogDescription>
            MCP servers and OpenAPI specs expose their tools automatically. Raw HTTP is for anything else.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="int-name">Name</Label>
            <Input id="int-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HubSpot" />
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
              <Label htmlFor="int-url">MCP server URL</Label>
              <Input id="int-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="stdio://my-mcp or http://localhost:8080" className="font-mono text-xs" />
            </div>
          )}
          {kind === 'api' && (
            <div className="space-y-1.5">
              <Label htmlFor="int-spec">OpenAPI spec URL</Label>
              <Input id="int-spec" value={specUrl} onChange={(e) => setSpecUrl(e.target.value)} placeholder="https://api.example.com/openapi.json" className="font-mono text-xs" />
            </div>
          )}
          {kind === 'http' && (
            <div className="space-y-1.5">
              <Label htmlFor="int-endpoint">Endpoint URL</Label>
              <Input id="int-endpoint" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com" className="font-mono text-xs" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending ? 'Connecting…' : 'Connect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ----------------------------------------------------------------------------
// Integration card
// ----------------------------------------------------------------------------

function IntegrationCard({ int, delay }: { int: Integration; delay: number }) {
  const [open, setOpen] = React.useState(false)
  const kindMeta = KIND_META[int.kind]
  const KindIcon = kindMeta.icon
  const borderColor = COLOR_BORDER[int.color] ?? 'border-l-border'
  const configUrl = int.config.url ?? int.config.specUrl
  const tools = int.tools ?? []
  const visibleTools = tools.slice(0, 6)
  const extra = tools.length - visibleTools.length

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
    >
      <Card className={cn('overflow-hidden p-0 border-l-4', borderColor)}>
        <div className="p-4">
          <div className="flex items-start gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
              <KindIcon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium">{int.name}</span>
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

          <div className="mt-3 flex items-center gap-2">
            <Badge variant="outline" className="gap-1 text-[10px]">
              <Wrench className="h-2.5 w-2.5" />
              {tools.length} {tools.length === 1 ? 'tool' : 'tools'}
            </Badge>
            {tools.length > 0 && (
              <Collapsible open={open} onOpenChange={setOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-[11px]">
                    {open ? 'Hide tools' : 'Show tools'}
                    <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
                  </Button>
                </CollapsibleTrigger>
              </Collapsible>
            )}
          </div>

          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleContent className="mt-2">
              <div className="space-y-1 rounded-lg border border-border/60 bg-muted/30 p-2">
                {visibleTools.map((t) => (
                  <div key={t.id} className="flex items-start gap-2 px-1 py-1 text-xs">
                    <code className="shrink-0 rounded bg-card px-1.5 py-0.5 font-mono text-[10px] text-foreground">{t.id}</code>
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium leading-tight">{t.name}</div>
                      <div className="line-clamp-1 text-[10px] text-muted-foreground">{t.description}</div>
                    </div>
                  </div>
                ))}
                {extra > 0 && (
                  <div className="px-1 pt-1 text-[10px] text-muted-foreground">+{extra} more</div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {configUrl && (
            <div className="mt-3 flex items-center gap-1.5 border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
              <Globe className="h-2.5 w-2.5" />
              <code className="truncate font-mono">{configUrl}</code>
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  )
}

// ----------------------------------------------------------------------------
// View
// ----------------------------------------------------------------------------

export function IntegrationsView() {
  const { data: integrations, isLoading } = useIntegrations()

  // Group by category, preserving CATEGORIES order; unknown categories appended at the end.
  const grouped = React.useMemo(() => {
    const map = new Map<string, Integration[]>()
    for (const i of integrations ?? []) {
      const arr = map.get(i.category) ?? []
      arr.push(i)
      map.set(i.category, arr)
    }
    const ordered: { category: string; items: Integration[] }[] = []
    for (const c of CATEGORIES) {
      const arr = map.get(c.key)
      if (arr && arr.length > 0) ordered.push({ category: c.key, items: arr })
      map.delete(c.key)
    }
    for (const [category, items] of map.entries()) {
      ordered.push({ category, items })
    }
    return ordered
  }, [integrations])

  const totalTools = integrations?.reduce((acc, i) => acc + (i.tools?.length ?? 0), 0) ?? 0

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Plug className="h-4 w-4 text-muted-foreground" />
            Integrations
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {integrations?.length ?? '—'} connected · {totalTools} tools exposed
          </p>
        </div>
        <AddIntegrationDialog />
      </div>

      {/* Explainer */}
      <div className="rounded-xl border border-border bg-gradient-to-br from-primary/5 via-card to-card p-3.5">
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <PlugZap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>
            Every integration — MCP server, OpenAPI spec, or raw HTTP endpoint — exposes its capabilities as{' '}
            <span className="text-foreground">tools</span> with the same shape. Workflows just name a tool; they don&apos;t
            care what&apos;s underneath.
          </span>
        </p>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      ) : !integrations || integrations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Plug className="h-5 w-5" />
          </div>
          <h3 className="text-sm font-medium">No integrations yet</h3>
          <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
            Add your first connection — an MCP server, an OpenAPI spec, or a raw HTTP endpoint.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(({ category, items }) => {
            const label = CATEGORIES.find((c) => c.key === category)?.label ?? category
            return (
              <section key={category} className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <CircleDot className="h-3.5 w-3.5 text-muted-foreground" />
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</h3>
                  <span className="text-[10px] text-muted-foreground/60">{items.length}</span>
                  <div className="ml-2 h-px flex-1 bg-border/60" />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((i, idx) => (
                    <IntegrationCard key={i.id} int={i} delay={idx * 0.04} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
