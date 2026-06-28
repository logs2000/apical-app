'use client'

import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import type {
  Workflow,
  WorkflowJSON,
  Integration,
  Run,
  Credential,
  ExecutionPattern,
  ChatMessage,
  OAuthProvider,
  OAuthStartResponse,
  OAuthDemoConnectResponse,
} from './types'

async function j<T>(res: Response | Promise<Response>): Promise<T> {
  const r = await res
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    throw new Error((e as { error?: string }).error || `Request failed: ${r.status}`)
  }
  return r.json() as Promise<T>
}

// ---------------- Stats ----------------
export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: () =>
      j<{
        workflows: number
        activeWorkflows: number
        runsToday: number
        itemsThisWeek: number
        automaticPct: number
        aiCallsSaved: number
        estCostSavedCents: number
        flaggedOpen: number
        hardeningOpportunities: number
      }>(fetch('/api/stats').then((r) => r)),
    refetchInterval: 15000,
  })
}

// ---------------- Integrations ----------------
export function useIntegrations() {
  return useQuery<Integration[]>({
    queryKey: ['integrations'],
    queryFn: () => j(fetch('/api/integrations').then((r) => r)),
  })
}

export function useCreateIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      name: string
      kind: 'mcp' | 'api' | 'http'
      url?: string
      specUrl?: string
      category: string
      description?: string
      /** Source of the integration. Default 'private' for user-added ones. */
      source?: 'builtin' | 'private' | 'public'
      /** User's visibility choice for their own custom integrations. */
      visibility?: 'private' | 'public'
      /** Author attribution when contributing to the public library. */
      authorLabel?: string
    }) =>
      j<Integration>(
        fetch('/api/integrations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }).then((r) => r),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      qc.invalidateQueries({ queryKey: ['integrations-library'] })
    },
  })
}

// ---------------- Workflows ----------------
export function useWorkflows() {
  return useQuery<Workflow[]>({
    queryKey: ['workflows'],
    queryFn: () => j(fetch('/api/workflows').then((r) => r)),
  })
}

export function useWorkflow(id: string | null) {
  return useQuery<{ workflow: Workflow; patterns: ExecutionPattern[] }>({
    queryKey: ['workflow', id],
    queryFn: () => j(fetch(`/api/workflows/${id}`).then((r) => r)),
    enabled: !!id,
  })
}

export function useCreateWorkflow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      name: string
      description: string
      steps: WorkflowJSON
      trigger?: 'manual' | 'schedule'
      schedule?: string
      department?: string
      title?: string
      origin?: 'agent' | 'manual' | 'chat'
    }) =>
      j<Workflow>(
        fetch('/api/workflows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }).then((r) => r),
      ),
    onSuccess: (created) => {
      qc.setQueryData<Workflow[]>(['workflows'], (old) => {
        const list = old ?? []
        if (list.some((w) => w.id === created.id)) return list
        return [created, ...list]
      })
      qc.invalidateQueries({ queryKey: ['workflows'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    },
  })
}

export function useUpdateWorkflow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string
      patch: Partial<Pick<Workflow, 'name' | 'description' | 'trigger' | 'schedule' | 'status' | 'department' | 'title' | 'origin' | 'workspaceId' | 'runtime' | 'modelPreference' | 'confidenceThreshold' | 'autoHardenAfter' | 'allowedTools' | 'allowedCredentials'>> & { steps?: import('./types').WorkflowJSON }
    }) =>
      j<Workflow>(
        fetch(`/api/workflows/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }).then((r) => r),
      ),
    onSuccess: (wf) => {
      qc.invalidateQueries({ queryKey: ['workflows'] })
      qc.invalidateQueries({ queryKey: ['workflow', wf.id] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    },
  })
}

export function useDeleteWorkflow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      j<{ ok: true; id: string }>(
        fetch(`/api/workflows/${id}`, { method: 'DELETE' }).then((r) => r),
      ),
    // Optimistically remove the agent from the list so it disappears instantly,
    // before the server round-trip. Roll back if the delete fails.
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['workflows'] })
      const previous = qc.getQueryData<Workflow[]>(['workflows'])
      if (previous) {
        qc.setQueryData<Workflow[]>(
          ['workflows'],
          previous.filter((w) => w.id !== id),
        )
      }
      return { previous }
    },
    onError: (_err, _id, ctx) => {
      const previous = (ctx as { previous?: Workflow[] } | undefined)?.previous
      if (previous) qc.setQueryData(['workflows'], previous)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      qc.invalidateQueries({ queryKey: ['runs'] })
    },
  })
}

export function useHardenStep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, stepId, rule }: { id: string; stepId: string; rule: string }) =>
      j<{ workflow: Workflow; pattern: ExecutionPattern }>(
        fetch(`/api/workflows/${id}/harden`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stepId, rule }),
        }).then((r) => r),
      ),
    onSuccess: ({ workflow }) => {
      qc.invalidateQueries({ queryKey: ['workflows'] })
      qc.invalidateQueries({ queryKey: ['workflow', workflow.id] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    },
  })
}

export function useRunWorkflow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, trigger }: { id: string; trigger?: 'manual' | 'schedule' }) =>
      j<{ runId: string }>(
        fetch(`/api/workflows/${id}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trigger: trigger ?? 'manual' }),
        }).then((r) => r),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      qc.invalidateQueries({ queryKey: ['workflows'] })
    },
  })
}

// ---------------- Runs ----------------
export function useRuns(limit = 20, workflowId?: string | null) {
  return useQuery<Run[]>({
    queryKey: ['runs', limit, workflowId ?? 'all'],
    queryFn: () =>
      j(
        fetch(
          `/api/runs?limit=${limit}${workflowId ? `&workflowId=${encodeURIComponent(workflowId)}` : ''}`,
        ).then((r) => r),
      ),
    refetchInterval: 5000,
  })
}

export function useCancelRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (runId: string) =>
      j<{ ok: boolean; status: string }>(
        fetch(`/api/runs/${runId}/cancel`, { method: 'POST' }).then((r) => r),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: ['run'] })
    },
  })
}

export function useRun(id: string | null) {
  return useQuery<Run>({
    queryKey: ['run', id],
    queryFn: () => j(fetch(`/api/runs/${id}`).then((r) => r)),
    enabled: !!id,
    refetchInterval: (query) => {
      const d = query.state.data
      if (d && d.status === 'running') return 1500
      return false
    },
  })
}

// ---------------- Per-agent chat messages (persisted) ----------------
export function useAgentMessages(agentId: string | null) {
  return useQuery<import('./types').AgentMessage[]>({
    queryKey: ['agent-messages', agentId],
    queryFn: () => j(fetch(`/api/agents/${agentId}/messages`).then((r) => r)),
    enabled: !!agentId,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  })
}

export function useSaveAgentMessage(agentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { role: 'user' | 'agent'; content: string; events?: import('./types').AgentEvent[] }) =>
      j<import('./types').AgentMessage>(
        fetch(`/api/agents/${agentId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }).then((r) => r),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-messages', agentId] })
      qc.invalidateQueries({ queryKey: ['workflows'] })
    },
  })
}

export function useUpdateAgentMessage(agentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      messageId: string
      content?: string
      events?: import('./types').AgentEvent[]
    }) =>
      j<import('./types').AgentMessage>(
        fetch(`/api/agents/${agentId}/messages/${input.messageId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: input.content,
            events: input.events,
          }),
        }).then((r) => r),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-messages', agentId] })
    },
  })
}

export function useClearAgentMessages(agentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      j<{ ok: boolean }>(fetch(`/api/agents/${agentId}/messages`, { method: 'DELETE' }).then((r) => r)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-messages', agentId] }),
  })
}

// ---------------- Per-agent data (outputs, tables, state) ----------------
export function useAgentData(agentId: string | null, kind?: 'output' | 'table' | 'state') {
  return useQuery<import('./types').AgentDataRow[]>({
    queryKey: ['agent-data', agentId, kind],
    queryFn: () =>
      j(fetch(`/api/agents/${agentId}/data${kind ? `?kind=${kind}` : ''}`).then((r) => r)),
    enabled: !!agentId,
  })
}

export function useSuggestConfig(agentId: string | null) {
  return useMutation({
    mutationFn: () =>
      j<{
        schedule: string | null
        modelPreference: string | null
        confidenceThreshold: number | null
        autoHardenAfter: number | null
        reasoning: string
      }>(fetch(`/api/agents/${agentId}/suggest-config`, { method: 'POST' }).then((r) => r)),
  })
}

// ---------------- Briefing (proactive secretary update) ----------------
export function useBriefing(workspaceId?: string | null) {
  return useQuery<{
    status: 'all_good' | 'needs_attention' | 'has_errors'
    statusLine: string
    summary: string
    needsAttention: Array<{
      id: string
      agentId: string
      agentName: string
      kind: 'flagged_item' | 'approval_needed' | 'error'
      title: string
      detail: string
      action: 'answer' | 'approve' | 'view'
      runId: string
    }>
    activity: Array<{
      runId: string
      agentId: string
      agentName: string
      summary: string
      itemsProcessed: number
      automaticCount: number
      flaggedCount: number
      durationMs: number
      startedAt: string
    }>
    stats: {
      itemsThisWeek: number
      automaticPct: number
      flaggedOpen: number
      aiCallsSaved: number
      estCostSavedCents: number
    }
  }>({
    queryKey: ['briefing', workspaceId],
    queryFn: () =>
      j(
        fetch(`/api/briefing${workspaceId ? `?workspaceId=${workspaceId}` : ''}`).then((r) => r),
      ),
    staleTime: 30_000,
  })
}

// ---------------- Workspaces ----------------
export function useWorkspaces() {
  return useQuery<import('./types').Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: () => j(fetch('/api/workspaces').then((r) => r)),
  })
}

export function useCreateWorkspace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; description?: string; color?: string }) =>
      j<import('./types').Workspace>(
        fetch('/api/workspaces', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }).then((r) => r),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspaces'] }),
  })
}

// ---------------- User profile (for custom suggestions) ----------------
export function useProfile() {
  return useQuery<import('./types').UserProfile>({
    queryKey: ['profile'],
    queryFn: () => j(fetch('/api/profile').then((r) => r)),
  })
}

export function useUpdateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: {
      companyName?: string
      industry?: string
      notes?: string
      dataSources?: Array<{ label: string; kind: string; detail: string }>
    }) =>
      j<import('./types').UserProfile>(
        fetch('/api/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }).then((r) => r),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile'] }),
  })
}

// ---------------- Save credential (from chat API-discovery input) ----------------
export function useSaveCredential() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      service: string
      label: string
      kind: 'oauth' | 'apikey' | 'payment' | 'mcp_token'
      metaJson?: string
      agentProvisioned?: boolean
      canPay?: boolean
    }) =>
      j<import('./types').Credential>(
        fetch('/api/credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }).then((r) => r),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credentials'] }),
  })
}

// ---------------- MCP server connect ----------------
export function useConnectMcp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      name: string
      transport: 'stdio' | 'http'
      command?: string
      args?: string[]
      env?: Record<string, string>
      url?: string
      category?: string
    }) =>
      j<{ integration: Integration; tools: unknown[] }>(
        fetch('/api/mcp/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }).then((r) => r),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      qc.invalidateQueries({ queryKey: ['integrations-library'] })
    },
  })
}

// ---------------- Research (web search for API docs) ----------------
export function useResearch() {
  return useMutation({
    mutationFn: (input: { query: string }) =>
      j<import('./types').ResearchResult>(
        fetch('/api/research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }).then((r) => r),
      ),
  })
}

// ---------------- Analyze script (infer API from code) ----------------
export function useAnalyzeScript() {
  return useMutation({
    mutationFn: (input: { script: string; language?: string }) =>
      j<import('./types').ScriptAnalysis>(
        fetch('/api/analyze-script', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }).then((r) => r),
      ),
  })
}

// ---------------- Deep research (autonomous web crawling + workflow generation) ----------------
export function useDeepResearch() {
  return useMutation({
    mutationFn: (input: { goal: string; context?: string }) =>
      j<import('./types').ResearchPlan>(
        fetch('/api/agent/research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }).then((r) => r),
      ),
  })
}

// ---------------- SaaS Developer platform ----------------
export interface DeveloperAccount {
  id: string
  email: string
  name: string
  plan: 'free' | 'starter' | 'pro' | 'scale'
  balanceCents: number
  workspaceId: string | null
  status: string
  createdAt: string
}
export interface ApiKeyRow {
  id: string
  label: string
  prefix: string
  lastUsedAt: string | null
  lastUsedFrom: string | null
  status: string
  createdAt: string
}
export interface AuditLogRow {
  id: string
  action: string
  target: string | null
  success: boolean
  costCents: number
  detail: string | null
  source: string
  apiKeyLabel: string | null
  createdAt: string
}

export function useDevLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { apiKey: string }) =>
      j<{ developer: DeveloperAccount; apiKey: { id: string; label: string; prefix: string } }>(
        fetch('/api/dev/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }).then((r) => r),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dev-account'] }),
  })
}

export function useDevRegister() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { email: string; name?: string }) =>
      j<{ developer: DeveloperAccount; apiKey: { id: string; label: string; prefix: string; raw: string } }>(
        fetch('/api/dev/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }).then((r) => r),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dev-account'] }),
  })
}

export function useDevLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => fetch('/api/dev/auth/logout', { method: 'POST' }).then((r) => r),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dev-account'] })
      qc.setQueryData(['dev-account'], null)
    },
  })
}

export function useDevAccount() {
  return useQuery<DeveloperAccount | null>({
    queryKey: ['dev-account'],
    queryFn: async () => {
      const r = await fetch('/api/dev/account')
      if (r.status === 401) return null
      return j(r)
    },
    retry: false,
  })
}

export function useDevKeys() {
  return useQuery<ApiKeyRow[]>({
    queryKey: ['dev-keys'],
    queryFn: () => j(fetch('/api/dev/keys').then((r) => r)),
  })
}

export function useCreateDevKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { label: string }) =>
      j<{ id: string; label: string; prefix: string; raw: string }>(
        fetch('/api/dev/keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }).then((r) => r),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dev-keys'] }),
  })
}

export function useRevokeDevKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fetch(`/api/dev/keys/${id}`, { method: 'DELETE' }).then((r) => r),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dev-keys'] }),
  })
}

export function useDevUsage(days = 30) {
  return useQuery<{
    totalCalls: number
    totalCostCents: number
    callsByAction: Record<string, number>
    callsByDay: Array<{ date: string; calls: number; costCents: number }>
    agentsDeployed: number
    runsTriggered: number
    successRate: number
  }>({
    queryKey: ['dev-usage', days],
    queryFn: () => j(fetch(`/api/dev/usage?days=${days}`).then((r) => r)),
  })
}

export function useDevLogs(limit = 50) {
  return useQuery<AuditLogRow[]>({
    queryKey: ['dev-logs', limit],
    queryFn: () => j(fetch(`/api/dev/logs?limit=${limit}`).then((r) => r)),
  })
}

export function useDevBilling() {
  return useQuery<{
    plan: string
    balanceCents: number
    stripeCustomerId: string | null
    recentCharges: AuditLogRow[]
  }>({
    queryKey: ['dev-billing'],
    queryFn: () => j(fetch('/api/dev/billing').then((r) => r)),
  })
}

export function useDevTopup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { amountCents: number }) =>
      j<{ balanceCents: number }>(
        fetch('/api/dev/billing/topup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }).then((r) => r),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dev-billing'] })
      qc.invalidateQueries({ queryKey: ['dev-account'] })
    },
  })
}

export function useDevChangePlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { plan: string }) =>
      j<DeveloperAccount>(
        fetch('/api/dev/billing/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }).then((r) => r),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dev-account'] })
      qc.invalidateQueries({ queryKey: ['dev-billing'] })
    },
  })
}

export function useDevDeploy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { workflow: unknown }) =>
      j<{ agent: import('./types').Workflow; integrationsCreated: number; credentialsCreated: number }>(
        fetch('/api/dev/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }).then((r) => r),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dev-usage'] })
      qc.invalidateQueries({ queryKey: ['dev-logs'] })
    },
  })
}

export function useDevDocs() {
  return useQuery<{
    title: string
    tagline: string
    mcp: {
      name: string
      install: string
      description: string
      configs: Record<string, string>
      tools: Array<{ name: string; description: string; inputSchema?: Record<string, unknown> }>
    }
    rest: {
      baseUrl: string
      auth: string | { type?: string; header?: string; altHeader?: string; note?: string }
      endpoints: Array<{ method: string; path: string; description: string; example?: string; curl?: string }>
    }
    automationFile: unknown
    pricing: {
      currency: string
      note: string
      plans: Array<{ name?: string; price?: string; priceCents?: number; features?: string[] }>
      perRunCostCents: number
      freeActions: string[]
    }
  }>({
    queryKey: ['dev-docs'],
    queryFn: () => j(fetch('/api/dev/docs').then((r) => r)),
    staleTime: Infinity,
  })
}
// ---------------- Employee import (drag-and-drop JSON) ----------------
export function useImportEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { json: string }) =>
      j<{
        employee: Workflow
        integrationsCreated: number
        credentialsCreated: number
      }>(
        fetch('/api/employees/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }).then((r) => r),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      qc.invalidateQueries({ queryKey: ['integrations'] })
      qc.invalidateQueries({ queryKey: ['credentials'] })
    },
  })
}

// ---------------- Employee edit (apply a chat-proposed change) ----------------
export function useEditEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      id: string
      description?: string
      steps?: WorkflowJSON
      name?: string
      title?: string
      department?: string
    }) =>
      j<Workflow>(
        fetch(`/api/employees/${input.id}/edit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }).then((r) => r),
      ),
    onSuccess: (wf) => {
      qc.invalidateQueries({ queryKey: ['workflows'] })
      qc.invalidateQueries({ queryKey: ['workflow', wf.id] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    },
  })
}

// ---------------- Integration library (builtin / private / public) ----------------
export function useIntegrationLibrary(source?: 'public' | 'private' | 'builtin') {
  return useQuery<Integration[]>({
    queryKey: ['integrations-library', source],
    queryFn: () =>
      j(
        fetch(
          `/api/integrations/library${source ? `?source=${source}` : ''}`,
        ).then((r) => r),
      ),
  })
}

export function useInstallIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      j<Integration>(
        fetch(`/api/integrations/${id}/install`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }).then((r) => r),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      qc.invalidateQueries({ queryKey: ['integrations-library'] })
    },
  })
}

export function usePublishIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, authorLabel }: { id: string; authorLabel?: string }) =>
      j<Integration>(
        fetch(`/api/integrations/${id}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ authorLabel }),
        }).then((r) => r),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      qc.invalidateQueries({ queryKey: ['integrations-library'] })
    },
  })
}

// ---------------- Automation File schema (developer docs) ----------------
export function useDevSchema() {
  return useQuery<{
    description: string
    fields: Record<string, { type: string; required?: boolean; description: string }>
    example: unknown
  }>({
    queryKey: ['dev-schema'],
    queryFn: () => j(fetch('/api/dev/schema').then((r) => r)),
    staleTime: Infinity,
  })
}

// ---------------- Credentials ----------------
export function useCredentials() {
  return useQuery<Credential[]>({
    queryKey: ['credentials'],
    queryFn: () => j(fetch('/api/credentials').then((r) => r)),
  })
}

export function useProvisionCredential() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { service: string; kind: 'oauth' | 'apikey' | 'payment' | 'mcp_token' }) =>
      j<Credential>(
        fetch('/api/credentials/provision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }).then((r) => r),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credentials'] }),
  })
}

// ---------------- OAuth providers (Connections tab) ----------------
export function useOAuthProviders() {
  return useQuery<OAuthProvider[]>({
    queryKey: ['oauth-providers'],
    queryFn: () => j(fetch('/api/oauth/providers').then((r) => r)),
  })
}

/**
 * Start the OAuth 2.0 authorization-code flow. Returns either:
 *   - { authorizationUrl, state, demoMode: false } → redirect the browser.
 *   - { demoMode: true, message } → call useOAuthDemoConnect next.
 */
export function useOAuthStart() {
  return useMutation({
    mutationFn: (input: {
      provider: string
      customClientId?: string
      customClientSecret?: string
    }) =>
      j<OAuthStartResponse>(
        fetch('/api/oauth/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }).then((r) => r),
      ),
  })
}

/** Simulate an OAuth connection (dev/demo). Stores a fake-but-distinctive token. */
export function useOAuthDemoConnect() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { provider: string }) =>
      j<OAuthDemoConnectResponse>(
        fetch('/api/oauth/demo-connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }).then((r) => r),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credentials'] }),
  })
}

/** Revoke a previously-connected OAuth credential (soft delete). */
export function useOAuthDisconnect() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { provider: string }) =>
      j<{ credential: Credential; disconnected: true; provider: string }>(
        fetch('/api/oauth/disconnect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }).then((r) => r),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credentials'] }),
  })
}
