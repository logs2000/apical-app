'use client'

// ModelsSection — the revamped Models settings page.
//
// Consumes the BYOK + LLM gateway + usage APIs built in Task 1-LLM:
//   GET    /api/llm/models    — model registry + custom models + configured flags
//   POST   /api/llm/models    — create a CustomModel row
//   PATCH  /api/llm/models/[id] — toggle enabled / set as default (custom only)
//   DELETE /api/llm/models/[id] — remove a custom model
//   GET    /api/byok           — list BYOK keys (masked)
//   POST   /api/byok           — add a key
//   DELETE /api/byok/[id]      — remove a key
//   POST   /api/byok/validate  — test a key
//   GET    /api/usage          — period usage + per-model breakdown
//
// The component is self-contained: it pulls its own data via TanStack Query
// (hooks defined inline below) and renders 4 sections:
//   1. Header with a compact usage card on the right.
//   2. "Your API keys" — a grid of provider cards (BYOK entry).
//   3. "Available models" — model registry grouped by tier (Hosted / BYOK / Local).
//   4. "Custom models" — add/remove/list user-defined models.
//
// Style: matches the established Apical look (oauth-connect.tsx) — framer-motion
// entrance, shadcn/ui, emerald/neutral tokens, `useToast` for feedback.

import * as React from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import {
  Cpu,
  Plus,
  Trash2,
  KeyRound,
  ExternalLink,
  Loader2,
  Check,
  X,
  ShieldCheck,
  Zap,
  Brain,
  Eye,
  HardDrive,
  Cloud,
  Server,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  CircleDot,
} from 'lucide-react'
import {
  PROVIDER_META,
  type ModelDefinition,
  type ProviderId,
  type ModelTier,
} from '@/lib/platform/models'

// ============================================================================
// Types — mirror what the APIs return.
// ============================================================================

type ModelBadge = 'fast' | 'powerful' | 'vision' | 'local' | 'byok'

interface AvailableModel extends ModelDefinition {
  configured: boolean
  custom?: boolean
}

interface ByokKey {
  id: string
  provider: string
  label: string
  keyPrefix: string
  baseUrl: string | null
  defaultModel: string | null
  status: string
  lastStatus: string | null // 'valid' | 'invalid' | 'rate_limited' | null
  lastCheckedAt: string | null
  createdAt: string
  updatedAt: string
}

interface UsageCurrent {
  used: number
  allowance: number
  overage: number
  overrunEnabled: boolean
  periodEnd: string | null
  plan: string
}

interface UsageResponse {
  current: UsageCurrent
  byModel: Array<{
    modelId: string
    provider: string
    totalTokens: number
    costCents: number
    calls: number
  }>
  byDay: Array<{ date: string; tokens: number; costCents: number }>
  recent: Array<{
    id: string
    modelId: string
    provider: string
    promptTokens: number
    completionTokens: number
    totalTokens: number
    costCents: number
    source: string
    refId: string | null
    createdAt: string
  }>
}

// ============================================================================
// Constants
// ============================================================================

// Providers that accept a real API key (and so appear in the BYOK grid).
// Local-server providers (ollama, llamacpp, vllm) are skipped here — they're
// addressable via the "Custom models" flow instead.
const BYOK_PROVIDERS: ProviderId[] = [
  'openai',
  'anthropic',
  'google',
  'azure_openai',
  'openrouter',
  'mistral',
  'groq',
  'together',
  'deepseek',
]

const TIER_ORDER: ModelTier[] = ['hosted', 'byok', 'local']

const TIER_META: Record<
  ModelTier,
  { label: string; icon: React.ComponentType<{ className?: string }>; subtitle: string }
> = {
  hosted: {
    label: 'Hosted by Apical',
    icon: Cloud,
    subtitle: 'Covered by your plan — no key needed.',
  },
  byok: {
    label: 'Bring your own key',
    icon: KeyRound,
    subtitle: 'Routes through your provider key. You pay the provider directly.',
  },
  local: {
    label: 'Local & self-hosted',
    icon: HardDrive,
    subtitle: 'Runs on your machine (Ollama, llama.cpp). Free + private.',
  },
}

const BADGE_META: Record<
  ModelBadge,
  { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }
> = {
  fast: { label: 'Fast', icon: Zap, cls: 'bg-primary/15 text-primary' },
  powerful: { label: 'Powerful', icon: Brain, cls: 'bg-primary/15 text-primary' },
  vision: { label: 'Vision', icon: Eye, cls: 'bg-primary/15 text-primary' },
  local: { label: 'Local', icon: HardDrive, cls: 'bg-muted text-muted-foreground' },
  byok: { label: 'BYOK', icon: KeyRound, cls: 'bg-muted text-muted-foreground' },
}

// localStorage key for the client-side "default registry model" — registry
// models don't have a server-side default field yet, so we persist this
// locally. CustomModel rows use the server's isDefault field.
const REGISTRY_DEFAULT_KEY = 'apical:models:default-registry'

// ============================================================================
// Helpers
// ============================================================================

async function j<T>(res: Promise<Response>): Promise<T> {
  const r = await res
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    throw new Error((e as { error?: string }).error || `Request failed: ${r.status}`)
  }
  return r.json() as Promise<T>
}

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M ctx`
  }
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}K ctx`
  }
  return `${tokens} ctx`
}

function formatCost(centsPer1M: number): string {
  if (centsPer1M === 0) return 'Free'
  const dollars = centsPer1M / 100
  if (dollars < 1) return `${centsPer1M}¢/1M`
  return `$${dollars.toFixed(2)}/1M`
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

// ============================================================================
// Inline TanStack Query hooks
// ============================================================================

const QK = {
  models: ['llm-models'] as const,
  byok: ['byok-keys'] as const,
  usage: ['usage'] as const,
}

function useModels() {
  return useQuery<AvailableModel[]>({
    queryKey: QK.models,
    queryFn: async () => {
      const d = await j<{ models: AvailableModel[] }>(fetch('/api/llm/models').then((r) => r))
      return d.models
    },
  })
}

function useByokKeys() {
  return useQuery<ByokKey[]>({
    queryKey: QK.byok,
    queryFn: async () => {
      const d = await j<{ keys: ByokKey[] }>(fetch('/api/byok').then((r) => r))
      return d.keys
    },
  })
}

function useUsage() {
  return useQuery<UsageResponse>({
    queryKey: QK.usage,
    queryFn: () => j(fetch('/api/usage').then((r) => r)),
  })
}

function useAddByokKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: {
      provider: string
      label: string
      key: string
      baseUrl?: string
      defaultModel?: string
    }) =>
      j(
        fetch('/api/byok', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(vars),
        }).then((r) => r),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.byok })
      qc.invalidateQueries({ queryKey: QK.models })
    },
  })
}

function useRemoveByokKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string }) =>
      j(fetch(`/api/byok/${vars.id}`, { method: 'DELETE' }).then((r) => r)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.byok })
      qc.invalidateQueries({ queryKey: QK.models })
    },
  })
}

function useValidateByokKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string }) =>
      j(
        fetch('/api/byok/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: vars.id }),
        }).then((r) => r),
      ) as Promise<{ valid: boolean; error?: string }>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.byok })
    },
  })
}

function useCreateCustomModel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: {
      name: string
      type: string
      provider: string
      modelId: string
      baseUrl?: string
      byokKeyId?: string
      isDefault?: boolean
    }) =>
      j(
        fetch('/api/llm/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(vars),
        }).then((r) => r),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.models })
    },
  })
}

function useDeleteCustomModel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string }) =>
      j(fetch(`/api/llm/models/${vars.id}`, { method: 'DELETE' }).then((r) => r)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.models })
    },
  })
}

function useUpdateCustomModel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; enabled?: boolean; isDefault?: boolean }) =>
      j(
        fetch(`/api/llm/models/${vars.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: vars.enabled,
            isDefault: vars.isDefault,
          }),
        }).then((r) => r),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.models })
    },
  })
}

// ============================================================================
// Main component
// ============================================================================

export function ModelsSection() {
  return <ModelsSectionInner />
}

export default ModelsSection

function ModelsSectionInner() {
  const modelsQ = useModels()
  const byokQ = useByokKeys()
  const usageQ = useUsage()
  const { toast } = useToast()
  const updateCustomMut = useUpdateCustomModel()

  // The "default model" — for custom models, sourced from the API; for
  // registry models, sourced from localStorage (default = apical:default).
  // The /api/llm/models response doesn't carry isDefault, so we also track
  // the user's chosen custom default in client state (it persists server-side
  // via PATCH, but we need a local mirror for instant UI feedback).
  const [registryDefault, setRegistryDefault] = React.useState<string>('apical:default')
  const [customDefaultId, setCustomDefaultId] = React.useState<string | null>(null)

  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(REGISTRY_DEFAULT_KEY)
      if (stored) setRegistryDefault(stored)
    } catch {
      // ignore — localStorage may be unavailable
    }
  }, [])

  // Group models by tier.
  const grouped = React.useMemo(() => {
    const map: Record<ModelTier, AvailableModel[]> = {
      hosted: [],
      byok: [],
      local: [],
    }
    for (const m of modelsQ.data ?? []) {
      map[m.tier].push(m)
    }
    return map
  }, [modelsQ.data])

  const allModels = modelsQ.data ?? []

  // Handle "set as default" for any model — registry (local) or custom (server).
  const handleSetDefault = React.useCallback(
    (model: AvailableModel) => {
      if (model.custom) {
        setCustomDefaultId(model.id)
        updateCustomMut.mutate(
          { id: model.id, isDefault: true },
          {
            onError: (err) => {
              toast({
                title: 'Could not set default',
                description: err instanceof Error ? err.message : 'Unknown error',
                variant: 'destructive',
              })
              setCustomDefaultId(null)
            },
          },
        )
      } else {
        setRegistryDefault(model.id)
        try {
          localStorage.setItem(REGISTRY_DEFAULT_KEY, model.id)
        } catch {
          // ignore
        }
        toast({
          title: 'Default model updated',
          description: `${model.name} is now your default.`,
        })
      }
    },
    [updateCustomMut, toast],
  )

  return (
    <div className="space-y-7">
      {/* ---------------- Header ---------------- */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">Models</h2>
          </div>
          <p className="max-w-xl text-sm text-muted-foreground">
            Pick which AI models power your agents. Use Apical-hosted models on your plan
            allowance, bring your own API key for free routing, or self-host a local model.
          </p>
        </div>
        <UsageCard usageQ={usageQ} />
      </motion.div>

      {/* ---------------- Your API keys ---------------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.2 }}
        className="space-y-3"
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Your API keys</h3>
            <p className="text-xs text-muted-foreground">
              Bring your own provider keys — Apical routes through them at no markup. Keys are
              encrypted at rest and never shown in full.
            </p>
          </div>
          {byokQ.data && byokQ.data.length > 0 && (
            <Badge variant="outline" className="border-primary/40 text-primary text-[10px]">
              {byokQ.data.length} connected
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {byokQ.isLoading
            ? Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))
            : BYOK_PROVIDERS.map((providerId, i) => (
                <ByokKeyCard
                  key={providerId}
                  providerId={providerId}
                  // Show the most recent key for this provider (there can be
                  // multiple with different labels).
                  keyRow={byokQ.data?.find((k) => k.provider === providerId)}
                  delay={i * 0.03}
                />
              ))}
        </div>
      </motion.section>

      {/* ---------------- Available models ---------------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.2 }}
        className="space-y-3"
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Available models</h3>
            <p className="text-xs text-muted-foreground">
              Toggle the models you want in your picker. Hosted models are always available; BYOK
              models appear once you connect a key.
            </p>
          </div>
          {modelsQ.isLoading && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
        </div>

        {modelsQ.isLoading ? (
          <div className="space-y-2">
            {TIER_ORDER.map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="space-y-5">
            {TIER_ORDER.map((tier) => {
              const tierModels = grouped[tier]
              if (!tierModels || tierModels.length === 0) return null
              const meta = TIER_META[tier]
              const TierIcon = meta.icon
              return (
                <div key={tier} className="space-y-2">
                  <div className="flex items-center gap-1.5 px-0.5">
                    <TierIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {meta.label}
                    </h4>
                    <span className="text-[10px] text-muted-foreground/70">
                      {tierModels.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2.5">
                    {tierModels.map((m, i) => (
                      <ModelCard
                        key={m.id}
                        model={m}
                        delay={i * 0.02}
                        isDefault={
                          m.custom
                            ? m.id === customDefaultId
                            : m.id === registryDefault
                        }
                        onSetDefault={() => handleSetDefault(m)}
                        onToggle={(next) => {
                          if (m.custom) {
                            updateCustomMut.mutate(
                              { id: m.id, enabled: next },
                              {
                                onError: (err) =>
                                  toast({
                                    title: 'Could not update model',
                                    description:
                                      err instanceof Error ? err.message : 'Unknown error',
                                    variant: 'destructive',
                                  }),
                              },
                            )
                          }
                        }}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
            {allModels.length === 0 && (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No models available yet. Add a custom model below to get started.
              </div>
            )}
          </div>
        )}
      </motion.section>

      {/* ---------------- Custom models ---------------- */}
      <CustomModelsSection
        models={allModels.filter((m) => m.custom)}
        isLoading={modelsQ.isLoading}
        byokKeys={byokQ.data ?? []}
        customDefaultId={customDefaultId}
        onSetDefault={handleSetDefault}
      />

      {/* Helper note */}
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-[11px] text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          <span className="font-medium text-foreground">Encrypted at rest.</span>{' '}
          Your API keys are AES-256-GCM encrypted with a key derived from the server&apos;s vault
          secret. The plaintext is never persisted or sent through chat — only used server-side to
          call the provider.
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// UsageCard
// ============================================================================

function UsageCard({ usageQ }: { usageQ: ReturnType<typeof useUsage> }) {
  const u = usageQ.data?.current
  if (usageQ.isLoading || !u) {
    return <Skeleton className="h-20 w-full max-w-xs rounded-xl" />
  }
  const allowance = u.allowance
  const unlimited = allowance === 0
  const used = u.used
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / allowance) * 100))
  const overage = u.overage
  const periodEnd = u.periodEnd ? new Date(u.periodEnd) : null

  const planLabel = u.plan.charAt(0).toUpperCase() + u.plan.slice(1)

  // Bar color: green when under 80%, amber under 100%, red at/over.
  const barCls =
    pct >= 100
      ? '[&_[data-slot=progress-indicator]]:bg-destructive'
      : pct >= 80
        ? '[&_[data-slot=progress-indicator]]:bg-amber-500'
        : ''

  return (
    <div className="w-full max-w-xs rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          This period
        </span>
        <Badge variant="outline" className="border-primary/40 text-primary text-[9px]">
          {planLabel}
        </Badge>
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-lg font-semibold tabular-nums">{formatNumber(used)}</span>
        <span className="text-xs text-muted-foreground">
          / {unlimited ? '∞' : formatNumber(allowance)} tokens
        </span>
      </div>
      {!unlimited && (
        <Progress value={pct} className={cn('mt-2 h-1.5', barCls)} />
      )}
      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        {overage > 0 ? (
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            {formatNumber(overage)} over
          </span>
        ) : (
          <span>{pct}% used</span>
        )}
        <span className="flex items-center gap-1">
          {u.overrunEnabled ? (
            <>
              <CircleDot className="h-3 w-3 text-primary" />
              Overrun on
            </>
          ) : periodEnd ? (
            `resets ${periodEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
          ) : (
            '—'
          )}
        </span>
      </div>
    </div>
  )
}

// ============================================================================
// ByokKeyCard — single provider card in the BYOK grid
// ============================================================================

function ByokKeyCard({
  providerId,
  keyRow,
  delay,
}: {
  providerId: ProviderId
  keyRow: ByokKey | undefined
  delay: number
}) {
  const meta = PROVIDER_META[providerId]
  const { toast } = useToast()
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const removeMut = useRemoveByokKey()
  const validateMut = useValidateByokKey()

  // Local "checking" state — toggled when the user clicks Test until the
  // mutation settles (gives instant feedback before the query refetches).
  const [checking, setChecking] = React.useState(false)

  const handleTest = async () => {
    if (!keyRow) return
    setChecking(true)
    try {
      const res = await validateMut.mutateAsync({ id: keyRow.id })
      if (res.valid) {
        toast({
          title: 'Key is valid',
          description: `${meta.name} accepted a test call.`,
        })
      } else {
        toast({
          title: 'Key test failed',
          description: res.error || 'The provider rejected the key.',
          variant: 'destructive',
        })
      }
    } catch (err) {
      toast({
        title: 'Could not validate key',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setChecking(false)
    }
  }

  const handleRemove = async () => {
    if (!keyRow) return
    try {
      await removeMut.mutateAsync({ id: keyRow.id })
      toast({
        title: 'Key removed',
        description: `Your ${meta.name} key (${keyRow.keyPrefix}) was deleted.`,
      })
      setConfirmOpen(false)
    } catch (err) {
      toast({
        title: 'Could not remove key',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    }
  }

  // Status badge for the existing key.
  const statusBadge = (() => {
    if (checking || validateMut.isPending) {
      return (
        <Badge
          variant="outline"
          className="border-amber-500/40 bg-amber-500/5 px-1 py-0 text-[9px] text-amber-600 dark:text-amber-400"
        >
          <Loader2 className="mr-0.5 h-2.5 w-2.5 animate-spin" /> Checking
        </Badge>
      )
    }
    if (!keyRow) return null
    if (keyRow.lastStatus === 'valid') {
      return (
        <Badge
          variant="outline"
          className="border-primary/40 bg-primary/5 px-1 py-0 text-[9px] text-primary"
        >
          <Check className="mr-0.5 h-2.5 w-2.5" /> Valid
        </Badge>
      )
    }
    if (keyRow.lastStatus === 'invalid') {
      return (
        <Badge
          variant="outline"
          className="border-destructive/40 bg-destructive/5 px-1 py-0 text-[9px] text-destructive"
        >
          <X className="mr-0.5 h-2.5 w-2.5" /> Invalid
        </Badge>
      )
    }
    return (
      <Badge variant="outline" className="px-1 py-0 text-[9px] text-muted-foreground">
        Untested
      </Badge>
    )
  })()

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.2 }}
      className={cn(
        'group flex flex-col gap-2 rounded-xl border bg-card p-3.5 transition-colors',
        keyRow
          ? 'border-primary/30 hover:border-primary/50'
          : 'border-border hover:border-primary/30',
      )}
    >
      {/* Header: icon + name + status */}
      <div className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-lg"
          aria-hidden
        >
          {meta.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{meta.name}</span>
            {statusBadge}
          </div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
            {keyRow ? keyRow.keyPrefix : meta.keyPrefixHint || 'No key yet'}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-1 flex items-center justify-end gap-1.5">
        {keyRow ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleTest}
              disabled={checking || validateMut.isPending || removeMut.isPending}
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="h-3 w-3" />
              <span className="ml-1">Test</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmOpen(true)}
              disabled={removeMut.isPending}
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
              <span className="ml-1">Remove</span>
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            onClick={() => setDialogOpen(true)}
            className="h-7 px-2.5 text-[11px]"
          >
            <Plus className="h-3 w-3" />
            <span className="ml-1">Connect</span>
          </Button>
        )}
      </div>

      <ByokKeyDialog providerId={providerId} open={dialogOpen} onOpenChange={setDialogOpen} />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">
              Remove {meta.name} key?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              The key <span className="font-mono">{keyRow?.keyPrefix}</span> will be permanently
              deleted from your vault. Any custom models linked to this key will fall back to
              &ldquo;not configured&rdquo;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs" disabled={removeMut.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              disabled={removeMut.isPending}
              className="bg-destructive text-destructive-foreground text-xs hover:bg-destructive/90"
            >
              {removeMut.isPending ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="mr-1 h-3 w-3" />
              )}
              Remove key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  )
}

// ============================================================================
// ByokKeyDialog — the dialog for adding a new BYOK key
// ============================================================================

function ByokKeyDialog({
  providerId,
  open,
  onOpenChange,
}: {
  providerId: ProviderId
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const meta = PROVIDER_META[providerId]
  const { toast } = useToast()
  const addMut = useAddByokKey()

  const [label, setLabel] = React.useState('')
  const [key, setKey] = React.useState('')
  const [baseUrl, setBaseUrl] = React.useState(meta.defaultBaseUrl ?? '')
  const [defaultModel, setDefaultModel] = React.useState('')

  // Reset fields when the dialog opens.
  React.useEffect(() => {
    if (open) {
      setLabel('Default')
      setKey('')
      setBaseUrl(meta.defaultBaseUrl ?? '')
      setDefaultModel('')
    }
  }, [open, meta.defaultBaseUrl])

  const handleSubmit = async () => {
    if (!key.trim()) return
    try {
      await addMut.mutateAsync({
        provider: providerId,
        label: label.trim() || 'Default',
        key: key.trim(),
        baseUrl: meta.configurableBaseUrl ? baseUrl.trim() || undefined : undefined,
        defaultModel: defaultModel.trim() || undefined,
      })
      toast({
        title: `${meta.name} key added`,
        description: 'Encrypted and stored in your vault.',
      })
      onOpenChange(false)
    } catch (err) {
      toast({
        title: 'Could not add key',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span aria-hidden>{meta.icon}</span>
            <span>Connect {meta.name}</span>
          </DialogTitle>
          <DialogDescription className="text-xs">{meta.help}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* Get-a-key link */}
          {meta.keyUrl && (
            <a
              href={meta.keyUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary transition-colors hover:border-primary/50 hover:bg-primary/10"
            >
              <span className="flex items-center gap-1.5">
                <ExternalLink className="h-3.5 w-3.5" />
                Get an {meta.name} API key
              </span>
              <span className="text-[10px] text-primary/70">opens in a new tab</span>
            </a>
          )}

          {/* Label */}
          <div>
            <Label className="text-xs">Label</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Default"
              className="mt-1 text-sm"
              autoComplete="off"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              A name for this key. Useful if you keep multiple {meta.name} keys.
            </p>
          </div>

          {/* API key */}
          <div>
            <Label className="text-xs">API key</Label>
            <Input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={meta.keyPrefixHint || 'Paste your key here'}
              className="mt-1 font-mono text-sm"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {/* Base URL — only if configurable */}
          {meta.configurableBaseUrl && (
            <div>
              <Label className="text-xs">Base URL</Label>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={meta.defaultBaseUrl ?? 'https://api.example.com/v1'}
                className="mt-1 font-mono text-sm"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Override only if you use a proxy or self-hosted gateway. Leave as-is for the
                provider default.
              </p>
            </div>
          )}

          {/* Default model — optional */}
          <div>
            <Label className="text-xs">
              Default model <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              placeholder="e.g. gpt-4o-mini"
              className="mt-1 font-mono text-sm"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Pre-fills the model picker when this key is selected.
            </p>
          </div>

          {/* Reassurance */}
          <div className="flex items-start gap-1.5 rounded-lg border border-border bg-muted/30 p-2 text-[10px] text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
            <div>
              Encrypted at rest with AES-256-GCM. The plaintext is never persisted or logged. You
              can revoke or replace this key any time.
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs"
            disabled={addMut.isPending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!key.trim() || addMut.isPending}
            className="text-xs"
          >
            {addMut.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <KeyRound className="mr-1 h-3 w-3" />
            )}
            Add key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// ModelCard — a single model in the registry
// ============================================================================

function ModelCard({
  model,
  delay,
  isDefault,
  onSetDefault,
  onToggle,
}: {
  model: AvailableModel
  delay: number
  isDefault: boolean
  onSetDefault: () => void
  onToggle: (enabled: boolean) => void
}) {
  const meta = PROVIDER_META[model.provider]
  const badge = model.badge ? BADGE_META[model.badge] : null
  const BadgeIcon = badge?.icon
  const [enabled, setEnabled] = React.useState(true)

  const handleToggle = (next: boolean) => {
    setEnabled(next)
    onToggle(next)
  }

  const configured = model.configured
  const needsKey = model.tier === 'byok' && !configured
  const isFree = model.inputCostCentsPer1M === 0 && model.outputCostCentsPer1M === 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.18 }}
      className={cn(
        'group rounded-xl border bg-card p-3.5 transition-colors',
        isDefault ? 'border-primary/40' : 'border-border hover:border-primary/30',
        !enabled && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        {/* Provider icon */}
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-lg"
          aria-hidden
        >
          {meta.icon}
        </div>

        {/* Name + meta */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-medium">{model.name}</span>
            {badge && BadgeIcon && (
              <Badge variant="outline" className={cn('px-1 py-0 text-[9px]', badge.cls)}>
                <BadgeIcon className="mr-0.5 h-2.5 w-2.5" />
                {badge.label}
              </Badge>
            )}
            {isDefault && (
              <Badge
                variant="outline"
                className="border-primary/40 bg-primary/10 px-1 py-0 text-[9px] text-primary"
              >
                <Sparkles className="mr-0.5 h-2.5 w-2.5" /> Default
              </Badge>
            )}
            {model.custom && (
              <Badge variant="outline" className="px-1 py-0 text-[9px] text-muted-foreground">
                Custom
              </Badge>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
            {model.description}
          </p>
          {/* Specs row */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Server className="h-3 w-3" />
              {formatContext(model.contextWindow)}
            </span>
            <span className="flex items-center gap-1">
              {isFree ? (
                <span className="text-primary">Free</span>
              ) : (
                <>
                  {formatCost(model.inputCostCentsPer1M)}
                  <span className="text-muted-foreground/60">in</span>
                  <span className="text-muted-foreground/40">·</span>
                  {formatCost(model.outputCostCentsPer1M)}
                  <span className="text-muted-foreground/60">out</span>
                </>
              )}
            </span>
            {model.supportsVision && (
              <span className="flex items-center gap-0.5">
                <Eye className="h-2.5 w-2.5" /> Vision
              </span>
            )}
            {model.supportsTools && (
              <span className="flex items-center gap-0.5">
                <Cpu className="h-2.5 w-2.5" /> Tools
              </span>
            )}
          </div>
        </div>

        {/* Actions column */}
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Switch
            checked={enabled}
            onCheckedChange={handleToggle}
            aria-label="Toggle model in picker"
          />
          <div className="flex items-center gap-1">
            {/* Configured check / Add key CTA */}
            {configured ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-primary">
                      <Check className="h-3 w-3" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">Configured</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : needsKey ? (
              <span className="rounded-full border border-dashed border-border px-1.5 py-0.5 text-[9px] text-muted-foreground">
                Add key
              </span>
            ) : null}
            {/* Set-as-default */}
            {!isDefault && enabled && (
              <button
                onClick={onSetDefault}
                className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Set as default model"
              >
                Set default
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ============================================================================
// Custom models section
// ============================================================================

function CustomModelsSection({
  models,
  isLoading,
  byokKeys,
  customDefaultId,
  onSetDefault,
}: {
  models: AvailableModel[]
  isLoading: boolean
  byokKeys: ByokKey[]
  customDefaultId: string | null
  onSetDefault: (model: AvailableModel) => void
}) {
  const [addOpen, setAddOpen] = React.useState(false)
  const deleteMut = useDeleteCustomModel()
  const updateMut = useUpdateCustomModel()
  const { toast } = useToast()

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, duration: 0.2 }}
      className="space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Custom models</h3>
          <p className="text-xs text-muted-foreground">
            Add your own model — an OpenAI-compatible endpoint, a local Ollama server, or a hosted
            model not in our registry.
          </p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)} className="h-7 px-2.5 text-[11px]">
          <Plus className="h-3 w-3" />
          <span className="ml-1">Add custom model</span>
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-20 rounded-xl" />
      ) : models.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
          No custom models yet. Click &ldquo;Add custom model&rdquo; to add an OpenAI-compatible
          endpoint, an Ollama server, or another model.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5">
          {models.map((m, i) => (
            <CustomModelRowCard
              key={m.id}
              model={m}
              delay={i * 0.02}
              isDefault={m.id === customDefaultId}
              onDelete={async () => {
                try {
                  await deleteMut.mutateAsync({ id: m.id })
                  toast({ title: 'Custom model removed' })
                } catch (err) {
                  toast({
                    title: 'Could not remove model',
                    description: err instanceof Error ? err.message : 'Unknown error',
                    variant: 'destructive',
                  })
                }
              }}
              onSetDefault={() => onSetDefault(m)}
              onToggle={(enabled) =>
                updateMut.mutate(
                  { id: m.id, enabled },
                  {
                    onError: (err) =>
                      toast({
                        title: 'Could not update model',
                        description: err instanceof Error ? err.message : 'Unknown error',
                        variant: 'destructive',
                      }),
                  },
                )
              }
              byokKeys={byokKeys}
            />
          ))}
        </div>
      )}

      <AddCustomModelDialog open={addOpen} onOpenChange={setAddOpen} byokKeys={byokKeys} />
    </motion.section>
  )
}

function CustomModelRowCard({
  model,
  delay,
  isDefault,
  onDelete,
  onSetDefault,
  onToggle,
}: {
  model: AvailableModel
  delay: number
  isDefault: boolean
  onDelete: () => Promise<void>
  onSetDefault: () => void
  onToggle: (enabled: boolean) => void
  byokKeys: ByokKey[]
}) {
  const meta = PROVIDER_META[model.provider]
  const [enabled, setEnabled] = React.useState(true)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.18 }}
      className={cn(
        'rounded-xl border bg-card p-3.5 transition-colors',
        isDefault ? 'border-primary/40' : 'border-border hover:border-primary/30',
        !enabled && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-lg"
          aria-hidden
        >
          {meta.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-medium">{model.name}</span>
            {isDefault && (
              <Badge
                variant="outline"
                className="border-primary/40 bg-primary/10 px-1 py-0 text-[9px] text-primary"
              >
                <Sparkles className="mr-0.5 h-2.5 w-2.5" /> Default
              </Badge>
            )}
            <Badge variant="outline" className="px-1 py-0 text-[9px] text-muted-foreground">
              {model.tier === 'local' ? 'Offline' : model.tier === 'byok' ? 'Online API' : 'Hosted'}
            </Badge>
          </div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
            {model.provider} · {model.apiModelId}
            {model.configured ? (
              <span className="ml-2 inline-flex items-center gap-0.5 text-primary">
                <Check className="h-2.5 w-2.5" /> configured
              </span>
            ) : (
              <span className="ml-2 text-amber-600 dark:text-amber-400">not configured</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Switch
            checked={enabled}
            onCheckedChange={(next) => {
              setEnabled(next)
              onToggle(next)
            }}
            aria-label="Toggle custom model"
          />
          <div className="flex items-center gap-1">
            {!isDefault && enabled && (
              <button
                onClick={onSetDefault}
                className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Set as default model"
              >
                Set default
              </button>
            )}
            <button
              onClick={() => setConfirmOpen(true)}
              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              title="Remove model"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">
              Remove &ldquo;{model.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              The custom model will be removed from your picker. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs" disabled={deleting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setDeleting(true)
                await onDelete()
                setDeleting(false)
                setConfirmOpen(false)
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground text-xs hover:bg-destructive/90"
            >
              {deleting ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="mr-1 h-3 w-3" />
              )}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  )
}

// ============================================================================
// AddCustomModelDialog
// ============================================================================

const TYPE_OPTIONS = [
  {
    key: 'online' as const,
    label: 'Online API',
    icon: Cloud,
    desc: 'OpenAI, Anthropic, etc. — needs a key.',
  },
  {
    key: 'offline' as const,
    label: 'Offline',
    icon: HardDrive,
    desc: 'Self-hosted Ollama / llama.cpp server.',
  },
  {
    key: 'hosted' as const,
    label: 'Hosted',
    icon: Cpu,
    desc: 'Apical-managed (advanced).',
  },
]

function AddCustomModelDialog({
  open,
  onOpenChange,
  byokKeys,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  byokKeys: ByokKey[]
}) {
  const { toast } = useToast()
  const createMut = useCreateCustomModel()

  const [name, setName] = React.useState('')
  const [type, setType] = React.useState<'online' | 'offline' | 'hosted'>('online')
  const [provider, setProvider] = React.useState<string>('openai')
  const [modelId, setModelId] = React.useState('')
  const [baseUrl, setBaseUrl] = React.useState('')
  const [byokKeyId, setByokKeyId] = React.useState<string>('')

  // Reset on open.
  React.useEffect(() => {
    if (open) {
      setName('')
      setType('online')
      setProvider('openai')
      setModelId('')
      setBaseUrl('')
      setByokKeyId('')
    }
  }, [open])

  // When type changes, set a sensible default provider.
  React.useEffect(() => {
    if (type === 'offline') setProvider('ollama')
    else if (type === 'hosted') setProvider('apical')
    else if (type === 'online' && (provider === 'ollama' || provider === 'apical')) {
      setProvider('openai')
    }
  }, [type, provider])

  const providerMeta = PROVIDER_META[provider as ProviderId]
  const availableKeysForProvider = byokKeys.filter((k) => k.provider === provider)

  const handleSubmit = async () => {
    if (!name.trim() || !modelId.trim()) return
    try {
      await createMut.mutateAsync({
        name: name.trim(),
        type,
        provider,
        modelId: modelId.trim(),
        baseUrl: baseUrl.trim() || undefined,
        byokKeyId: type === 'online' && byokKeyId ? byokKeyId : undefined,
        isDefault: false,
      })
      toast({
        title: 'Custom model added',
        description: `${name} is now in your picker.`,
      })
      onOpenChange(false)
    } catch (err) {
      toast({
        title: 'Could not add model',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" />
            Add a custom model
          </DialogTitle>
          <DialogDescription className="text-xs">
            Use this for any model not in our registry — an OpenAI-compatible endpoint, a local
            Ollama server, or another provider.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5 py-1">
          {/* Type selector */}
          <div>
            <Label className="mb-1.5 block text-xs">Type</Label>
            <div className="grid grid-cols-3 gap-2">
              {TYPE_OPTIONS.map((opt) => {
                const Icon = opt.icon
                const active = type === opt.key
                return (
                  <button
                    key={opt.key}
                    onClick={() => setType(opt.key)}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-lg border p-2.5 text-center transition-colors',
                      active
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/30',
                    )}
                  >
                    <Icon
                      className={cn('h-4 w-4', active ? 'text-primary' : 'text-muted-foreground')}
                    />
                    <span className="text-[11px] font-medium">{opt.label}</span>
                    <span className="text-[9px] text-muted-foreground">{opt.desc}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Display name */}
          <div>
            <Label className="text-xs">Display name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. GPT-4o (mine), Local Llama"
              className="mt-1 text-sm"
            />
          </div>

          {/* Provider */}
          <div>
            <Label className="text-xs">Provider</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger className="mt-1 text-sm">
                <SelectValue placeholder="Pick a provider" />
              </SelectTrigger>
              <SelectContent>
                {Object.values(PROVIDER_META).map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-sm">
                    <span className="mr-1.5">{p.icon}</span>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {providerMeta && (
              <p className="mt-1 text-[10px] text-muted-foreground">{providerMeta.help}</p>
            )}
          </div>

          {/* Model id */}
          <div>
            <Label className="text-xs">Model id</Label>
            <Input
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder={
                type === 'offline'
                  ? 'llama3.1, qwen2.5, mistral'
                  : type === 'hosted'
                    ? 'apical-default'
                    : 'gpt-4o, claude-3-5-sonnet-20241022'
              }
              className="mt-1 font-mono text-sm"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              The model id sent to the provider&apos;s API.
            </p>
          </div>

          {/* Base URL — for online + offline */}
          {type !== 'hosted' && (
            <div>
              <Label className="text-xs">
                {type === 'offline' ? 'Local server URL' : 'Base URL'}
              </Label>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={
                  type === 'offline'
                    ? 'http://localhost:11434'
                    : providerMeta?.defaultBaseUrl ?? 'https://api.openai.com/v1'
                }
                className="mt-1 font-mono text-sm"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}

          {/* API key select — for online only */}
          {type === 'online' && (
            <div>
              <Label className="text-xs">API key</Label>
              {availableKeysForProvider.length === 0 ? (
                <div className="mt-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] text-amber-700 dark:text-amber-400">
                  <div className="flex items-start gap-1.5">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <div>
                      No {providerMeta?.name} key connected. Add one in the &ldquo;Your API
                      keys&rdquo; section above, or this model will appear as &ldquo;not
                      configured&rdquo; in your picker.
                    </div>
                  </div>
                </div>
              ) : (
                <Select value={byokKeyId} onValueChange={setByokKeyId}>
                  <SelectTrigger className="mt-1 text-sm">
                    <SelectValue placeholder="Pick a key (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableKeysForProvider.map((k) => (
                      <SelectItem key={k.id} value={k.id} className="text-sm">
                        {k.label}{' '}
                        <span className="font-mono text-muted-foreground">({k.keyPrefix})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="mt-1 text-[10px] text-muted-foreground">
                Linking a key lets Apical route to this model. Unlinked models show as not
                configured.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs"
            disabled={createMut.isPending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!name.trim() || !modelId.trim() || createMut.isPending}
            className="text-xs"
          >
            {createMut.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Plus className="mr-1 h-3 w-3" />
            )}
            Add model
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
