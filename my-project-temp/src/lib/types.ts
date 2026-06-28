// Apical shared types — the contract between frontend, backend, and runtime.
// Workflows are n8n-like automations: an ordered list of deterministic nodes
// (code, HTTP, MCP, integrations, gates). Production runs execute WITHOUT an
// agent. Agents design, freeze, schedule, monitor, and improve workflows.

export type StepKind = 'tool' | 'reason' | 'gate' | 'spawn'

export type TriggerKind = 'manual' | 'schedule'

export type IntegrationKind = 'mcp' | 'api' | 'http'

/** Where an agent runs. Local = desktop app (fs/cli/net access). Hosted = Apical server. */
export type AgentRuntime = 'local' | 'hosted'

export type WorkflowStatus = 'draft' | 'active' | 'paused'

export type RunStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'awaiting_gate'
  | 'cancelled'

export type RunStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'flagged'
  | 'skipped'
  | 'awaiting'
  | 'failed'

/** A tool exposed by an integration. Same shape whether from MCP, API spec, or raw HTTP. */
export interface ToolDef {
  id: string // e.g. "gmail.send"
  name: string
  description: string
  integrationId: string
  inputSchema?: Record<string, unknown>
}

/** An integration is a connection to something in the world. */
export interface IntegrationConfig {
  url?: string
  specUrl?: string
  auth?: {
    type: 'oauth' | 'apikey' | 'basic' | 'none' | 'mcp_token'
    ref?: string // reference into the credential vault
  }
  /** For MCP integrations: how to reach the server. */
  mcp?: McpServerConfig
}

/** How to reach an MCP server. */
export interface McpServerConfig {
  /**
   * Transport: stdio (spawn a local process), http (Streamable HTTP — the
   * modern MCP remote transport), or sse (legacy SSE — used by older servers
   * that haven't migrated to Streamable HTTP yet).
   */
  transport: 'stdio' | 'http' | 'sse'
  /** For stdio: the command + args to spawn (e.g. ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"]). */
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** For http / sse: the server URL. */
  url?: string
  /**
   * For http / sse: custom HTTP headers to send with every request. Use this
   * for Bearer tokens (`{ Authorization: 'Bearer xxx' }`) or any other auth
   * header the remote MCP server requires. Headers are stored in the
   * Integration config JSON — make sure your vault encryption covers the
   * config field if you store secrets here.
   */
  headers?: Record<string, string>
  /**
   * For http / sse: an optional bearer token shorthand. If set, we'll add
   * `Authorization: Bearer <token>` to the headers (merged with any explicit
   * `headers` — explicit wins). Provided as a convenience since Bearer is the
   * most common remote-MCP auth scheme.
   */
  bearerToken?: string
}

export type IntegrationSource = 'builtin' | 'private' | 'public'
export type IntegrationVisibility = 'private' | 'public'

export interface Integration {
  id: string
  name: string
  kind: IntegrationKind
  description: string
  category: string
  color: string
  status: 'connected' | 'error' | 'draft'
  config: IntegrationConfig
  tools: ToolDef[]
  /** Where this integration came from. */
  source: IntegrationSource
  /** User's choice for their own custom integrations. */
  visibility: IntegrationVisibility
  /** Who contributed a public one (e.g. "@hannah", "community"). */
  authorLabel?: string | null
  /** Install count for public library entries. */
  installs: number
  createdAt: string
  updatedAt: string
}

/** A single step in a workflow. */
export interface WorkflowStep {
  id: string
  kind: StepKind
  label: string
  /** For tool steps: the tool to call, e.g. "files.list" */
  tool?: string
  /** For tool steps: the inputs, may reference earlier step outputs via {{stepId.field}} */
  inputs?: Record<string, unknown>
  /**
   * For tool steps: an inline raw HTTP call. When present, the runtime makes
   * this request directly instead of looking up a named tool. This lets users
   * define custom API calls without a full Integration record. URL, headers,
   * and body may all use {{stepId.field}} refs + {{cred:service.field}} vault refs.
   */
  http?: HttpCallSpec
  /** For reason steps: the prompt the model reasons over. */
  prompt?: string
  /** For reason steps: the tools the model may call while reasoning. */
  allowedTools?: string[]
  /** For reason steps: the required output shape (JSON schema-ish). */
  outputShape?: Record<string, string>
  /** For reason steps: confidence threshold below which the run flags for review. */
  confidenceThreshold?: number
  /** For spawn steps: the task to delegate to a temporary subagent. */
  spawnPrompt?: string
  /** For spawn steps: the tools the subagent may use. */
  spawnTools?: string[]
  /** For spawn steps: the required output shape from the subagent. */
  spawnOutputShape?: Record<string, string>
  /** For gate steps: what the human is approving. */
  gateMessage?: string
  /** Whether this step was hardened from `reason` → `tool` by self-optimization. */
  hardened?: boolean
  /** The deterministic rule applied when hardened. */
  rule?: string
  /** Optional note shown in the UI. */
  note?: string
  /** Integration that owns this tool step (OpenAPI/MCP/builtin). */
  integrationId?: string
  /** Deterministic MCP call — production runs invoke this without an agent. */
  mcp?: McpCallSpec
  /** Deterministic code/script — production runs execute without an agent. */
  code?: CodeCallSpec
}

/** MCP node in a production workflow (n8n-like). */
export interface McpCallSpec {
  integrationId: string
  tool: string
  args?: Record<string, unknown>
}

/** Code/script node in a production workflow (n8n-like). */
export interface CodeCallSpec {
  language: 'javascript' | 'python' | 'shell'
  source: string
  /** Optional JSON passed as `data` to JS scripts. */
  data?: unknown
}

/** An inline custom HTTP API call. Lets any tool step call any REST endpoint. */
export interface HttpCallSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string
  /** Header values may use {{cred:service.field}} to pull from the vault. */
  headers?: Record<string, string>
  /** Body may use {{stepId.field}} refs to earlier step outputs. */
  body?: unknown
  /** Auth pulled from the credential vault at runtime. */
  auth?: {
    type: 'bearer' | 'apikey_header' | 'basic' | 'none'
    /** Vault reference, e.g. "cred_stripe" — pulls the key/token from that credential. */
    ref?: string
    /** For apikey_header: which header name to put the key in. */
    headerName?: string
  }
  /** Optional: a friendly name for what this call does (shown in the UI). */
  description?: string
}

/** The full workflow as JSON. */
export interface WorkflowJSON {
  version: 1
  steps: WorkflowStep[]
}

/**
 * Department is a free-form descriptive label the agent creates naturally
 * (e.g. "Filing", "Inbox", "Billing"). Not a fixed enum — the workspace
 * groups agents by this string dynamically.
 */
export type Department = string

export interface Workflow {
  id: string
  name: string
  description: string
  steps: WorkflowJSON
  trigger: TriggerKind
  schedule?: string | null
  status: WorkflowStatus
  origin: 'agent' | 'manual' | 'chat'
  /** Descriptive department label, created naturally by the agent. */
  department: Department
  /** Role title, e.g. "Sorter", "Bookkeeper". */
  title?: string | null
  /** Which workspace this agent belongs to (null = default workspace). */
  workspaceId?: string | null
  /** Where this agent runs: local (desktop, fs/cli/net access) or hosted (Apical server). */
  runtime: AgentRuntime
  /** Parent agent id (if this is a subagent spawned by another agent). */
  parentAgentId?: string | null
  runsCount: number
  itemsProcessed: number
  automaticCount: number
  flaggedCount: number
  aiCallsSaved: number
  estCostSavedCents: number
  /** Which hosted model this agent prefers (registry id like openai:gpt-4o). Null = first available. */
  modelPreference?: string | null
  /** Default confidence threshold for reason steps that don't override (0-1). */
  confidenceThreshold?: number | null
  /** Auto-harden a reason step after N consistent runs (0 = off). */
  autoHardenAfter?: number | null
  /** Tool ids this agent is allowed to use. Null = all connected tools. */
  allowedTools?: string[] | null
  /** Credential ids this agent can access. Null = all. */
  allowedCredentials?: string[] | null
  createdAt: string
  updatedAt: string
}

export interface RunStep {
  id: string
  stepId: string
  kind: StepKind
  label: string
  status: RunStepStatus
  output?: unknown
  aiTokens: number
  aiCostCents: number
  startedAt?: string | null
  finishedAt?: string | null
  order: number
}

export interface RunReportItem {
  name: string
  outcome: 'automatic' | 'flagged' | 'gated'
  detail: string
}

/** Post-run agent review — success, outcome, efficiency, improvements. */
export interface RunReview {
  success: boolean
  outcomeAchieved: boolean
  summary: string
  efficiencyNotes?: string
  workflowSuggestions?: string[]
  /** True when the server auto-saved a workflow from a successful first run. */
  workflowAutoSaved?: boolean
}

export interface RunReport {
  summary: string
  items: RunReportItem[]
  flags: { stepId: string; reason: string; item: string }[]
  review?: RunReview
}

export interface Run {
  id: string
  workflowId: string
  workflowName: string
  status: RunStatus
  trigger: TriggerKind
  itemsProcessed: number
  automaticCount: number
  flaggedCount: number
  aiCallsUsed: number
  aiCallsSaved: number
  durationMs: number
  report?: RunReport | null
  startedAt: string
  finishedAt?: string | null
  steps: RunStep[]
}

export interface ExecutionPattern {
  id: string
  workflowId: string
  stepId: string
  signature: string
  output: unknown
  occurrences: number
  hardened: boolean
  rule?: string | null
}

export type CredentialKind = 'oauth' | 'apikey' | 'payment' | 'mcp_token'

export interface Credential {
  id: string
  service: string
  label: string
  kind: CredentialKind
  status: 'provisioning' | 'active' | 'expired' | 'revoked'
  meta: Record<string, unknown>
  agentProvisioned: boolean
  canPay: boolean
  /** For OAuth-connected credentials: the provider key ("google", "github", ...). */
  oauthProvider?: string | null
  /** ISO string; null for non-OAuth or non-expiring tokens. */
  oauthExpiresAt?: string | null
  createdAt: string
}

/** A provider in the OAuth catalog (Gmail, GitHub, Slack, ...). */
export interface OAuthProvider {
  id: string
  key: string
  name: string
  icon: string
  category: string
  description: string
  authorizationUrl: string
  tokenUrl: string
  scopes: string
  /** Whether Apical has its own OAuth client configured (false in dev → demo mode or BYO). */
  hasClientId: boolean
  supportsCustomCreds: boolean
  demoMode: boolean
  status: 'active' | 'coming_soon'
  createdAt: string
  updatedAt: string
}

/** The body returned by POST /api/oauth/start. */
export interface OAuthStartResponse {
  /** True when the connection proceeds in demo mode (no real OAuth). */
  demoMode?: boolean
  /** The provider key this start call was for. */
  provider?: string
  /** A human-readable note (esp. for demo mode). */
  message?: string
  /** The authorization URL the frontend should redirect to (real OAuth only). */
  authorizationUrl?: string
  /** The opaque state token we stored (also embedded in the auth URL). */
  state?: string
}

/** The body returned by POST /api/oauth/demo-connect. */
export interface OAuthDemoConnectResponse {
  credential: Credential
  demoMode: true
  provider: string
}

/** A clarification question the agent asks, with multiple-choice options. */
export interface ClarificationOption {
  key: string
  label: string
  description?: string
}
export interface ClarificationQuestion {
  id: string
  question: string
  options: ClarificationOption[]
  /** Whether the user can pick multiple. Default single. */
  multiple?: boolean
}

/** An API the agent researched and wants to add + request credentials for. */
export interface ApiDiscoveryCandidate {
  id: string
  service: string
  kind: IntegrationKind
  specUrl?: string
  url?: string
  description: string
  tools: Array<{ id: string; name: string; description: string }>
  /** Credential fields the user must fill to connect. */
  credentialFields: Array<{
    key: string
    label: string
    type: 'apikey' | 'oauth' | 'mcp_token'
    placeholder?: string
    required: boolean
  }>
}

/** The result of the agent researching API docs on the web. */
export interface ResearchResult {
  query: string
  /** What the agent found — a plain-English summary. */
  summary: string
  /** The sources it read. */
  sources: Array<{ title: string; url: string; snippet?: string }>
  /** APIs/MCP servers it discovered from the docs. */
  candidates: ApiDiscoveryCandidate[]
}

/** The result of the agent analyzing an attached code script. */
export interface ScriptAnalysis {
  /** What language/format the script is (curl, python, javascript, etc). */
  language: string
  /** Plain-English: what the script does. */
  summary: string
  /** The API call(s) inferred from the code. */
  inferredCalls: Array<{
    method: string
    url: string
    headers?: Record<string, string>
    bodyShape?: string
    authType?: 'bearer' | 'apikey_header' | 'basic' | 'none'
    description: string
  }>
  /** A proposed workflow step (inline http call) the user can add. */
  proposedStep?: WorkflowStep
  /** A proposed integration to save. */
  proposedIntegration?: {
    name: string
    kind: IntegrationKind
    description: string
    tools: Array<{ id: string; name: string; description: string }>
  }
}

/** Chat message in the agent conversation. */
export interface ChatMessage {
  id: string
  role: 'user' | 'agent'
  content: string
  /** When the agent proposes a new hire, it's attached here for rendering. */
  workflowProposal?: {
    name: string
    description: string
    department: Department
    title?: string
    steps: WorkflowJSON
  }
  /** When the agent is editing an existing employee, the id it's editing. */
  editingEmployeeId?: string
  /** When the agent suggests switching to an existing employee. */
  switchToEmployeeId?: string
  /** When a JSON file was imported, the resulting employee. */
  importedEmployee?: { id: string; name: string; title?: string | null; department: Department }
  /** A structured clarification question (multi-option card). */
  clarification?: ClarificationQuestion
  /** APIs the agent researched and wants to add, with credential requests. */
  apiDiscovery?: ApiDiscoveryCandidate[]
  /** The result of web research the agent did to find API/MCP docs. */
  research?: ResearchResult
  /** The result of analyzing an attached code script. */
  scriptAnalysis?: ScriptAnalysis
  /** Agent "thinking" trace shown while it looks around. */
  trace?: { label: string; detail?: string }[]
  /** Tailored suggestions for the empty-state, based on the user's profile. */
  suggestions?: { title: string; prompt: string; reason: string }[]
  /** The proactive secretary briefing, shown as the opening message. */
  briefing?: BriefingPayload
  /** A deep research plan — the agent crawled the web, found data sources, and proposes a workflow. */
  researchPlan?: ResearchPlan
  /** Live events from the autonomous agent loop (deep research mode). */
  agentLoopEvents?: AgentLoopEvent[]
  createdAt: string
}

/** A dashboard widget that an agent builds for itself. Agents populate these
 * during their runs to create custom dashboards on their detail page. */
export interface AgentWidget {
  id: string
  agentId: string
  type: 'stat' | 'table' | 'list' | 'chart' | 'alert' | 'progress'
  title: string
  /** The widget's data — shape depends on type. */
  data: WidgetData
  /** Where the widget appears on the agent's dashboard. */
  column?: number
  order?: number
  updatedAt: string
}

export interface WidgetData {
  // For 'stat': { value, label, trend?, unit? }
  // For 'table': { columns: string[], rows: unknown[][] }
  // For 'list': { items: Array<{ title, subtitle?, badge? }> }
  // For 'chart': { type: 'bar'|'line'|'pie', labels: string[], values: number[] }
  // For 'alert': { level: 'info'|'warning'|'critical', message }
  // For 'progress': { label, current, total, unit? }
  [key: string]: unknown
}

/** Glass-box events streamed from the agent loop (plan → act → observe → repeat).
 *  These render inline in the agent chat as the agent works. */
export type AgentEvent =
  | { type: 'token'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'tool_call'; tool: string; input?: string; inputParams?: Record<string, unknown>; status: 'calling' | 'success' | 'error'; result?: string }
  | { type: 'task_list'; tasks: Array<{ id: string; label: string; done: boolean }> }
  | { type: 'action_complete'; summary: string; itemsProcessed?: number; flagged?: number }
  | { type: 'error'; message: string }
  | { type: 'status'; status: 'thinking' | 'acting' | 'observing' | 'waiting_for_input' | 'done' }
  | { type: 'run_analysis'; success: boolean; outcomeAchieved?: boolean; summary: string; efficiencyNotes?: string; workflowSuggestions?: string[] }

/** A message in an agent's conversation thread (per-agent chat, not the main assistant). */
export interface AgentMessage {
  id: string
  role: 'user' | 'agent'
  content: string
  /** Glass-box events that happened during this agent turn (tool calls, reasoning, tasks). */
  events?: AgentEvent[]
  createdAt: string
}

/** A piece of structured data an agent produces / accumulates. Rendered in the Data tab. */
export type AgentDataKind = 'output' | 'table' | 'state'
export interface AgentDataRow {
  id: string
  agentId: string
  kind: AgentDataKind
  key: string
  /** For 'state' and 'table': the JSON value/rows. For 'output': usually null. */
  value?: unknown
  /** For 'output': path to the file. Null for state/table. */
  filePath?: string | null
  /** Optional metadata (mime type, size, etc.). */
  meta?: Record<string, unknown> | null
  updatedAt: string
}

/** A live event from the autonomous agent loop (POST /api/agent/think). */
export type AgentLoopEvent =
  | { type: 'status'; status: 'started' | 'preparing' | 'thinking' | 'acting' | 'observing' | 'done' }
  | { type: 'thought'; text: string }
  | { type: 'tool_call'; tool: string; input: Record<string, unknown> }
  | { type: 'observation'; tool: string; ok: boolean; output: unknown; display?: { title: string; summary: string; kind?: string } }
  | { type: 'final'; answer: string; proposedWorkflow?: WorkflowJSON; findings?: Array<{ source: string; url: string; type: string; description: string }> }
  | { type: 'error'; message: string }

/** The result of a deep autonomous research session. The agent searched the web,
 * crawled sites, found API endpoints or data patterns, and proposes a complete
 * workflow with rate-limit-aware steps + a schedule recommendation. */
export interface ResearchPlan {
  /** What the user asked for. */
  goal: string
  findings: Array<{
    source: string
    url: string
    type: 'website' | 'api' | 'data_feed' | 'directory'
    description: string
    /** Discovered API endpoints (if any). */
    endpoints?: Array<{ method: string; path: string; description: string }>
    /** Rate limit info (requests/min, retry-after header observed). */
    rateLimit?: string
  }>
  /** The agent's strategy in plain English. */
  strategy: string
  /** A proposed workflow (tool/reason/gate/spawn steps) that implements the strategy. */
  proposedWorkflow: WorkflowJSON
  /** How often the agent thinks this should run, and why. */
  scheduleRecommendation: {
    frequency: string
    reason: string
  }
  /** Estimated cost per run (AI calls + API calls). */
  estimatedCost: string
  /** Whether the agent needs any credentials/API keys to execute. */
  needsCredentials: Array<{ service: string; reason: string }>
}

/** The proactive secretary briefing payload (from GET /api/briefing). */
export interface BriefingPayload {
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
}

/** A workspace is an isolated environment (e.g. "Main", "R&D Lab", "Client: Acme"). */
export interface Workspace {
  id: string
  name: string
  description: string
  color: string
  createdAt: string
  updatedAt: string
}

/** A conversation in the chat history. */
export interface Conversation {
  id: string
  title: string
  workspaceId?: string | null
  pinned: boolean
  createdAt: string
  updatedAt: string
}

/** The user/company profile the agent uses to tailor suggestions. */
export interface UserProfile {
  id: string
  companyName: string
  industry: string
  notes: string
  dataSources: Array<{ label: string; kind: string; detail: string }>
  createdAt: string
  updatedAt: string
}

/**
 * The Apical Automation File format — a single JSON you can drop onto the chat
 * (or POST to the deploy API) to hire an employee complete with their tools
 * and credentials. Everything in `integrations` and `credentials` is installed
 * inline; `department` and `title` place the hire in the right room.
 */
export interface AutomationFile {
  $schema?: string
  name: string
  description?: string
  department?: Department
  title?: string
  trigger?: { type: 'manual' | 'schedule'; cron?: string; label?: string }
  /** Inline integration definitions to install (private by default). */
  integrations?: Array<{
    id: string
    name: string
    kind: IntegrationKind
    specUrl?: string
    url?: string
    description?: string
    category?: string
    visibility?: IntegrationVisibility
    auth?: IntegrationConfig['auth']
    /** For kind='mcp': the server connection config. */
    mcp?: McpServerConfig
    tools?: Array<{ id: string; name: string; description: string }>
  }>
  /** MCP servers to connect (shorthand — each becomes an Integration with kind='mcp'). */
  mcpServers?: Array<{
    name: string
    transport: 'stdio' | 'http' | 'sse'
    command?: string
    args?: string[]
    env?: Record<string, string>
    url?: string
    headers?: Record<string, string>
    bearerToken?: string
  }>
  /** Credential references / declarations to store in the vault. */
  credentials?: Array<{
    service: string
    label?: string
    kind: CredentialKind
    ref?: string
    meta?: Record<string, unknown>
  }>
  steps: WorkflowStep[]
}

/** Socket events for live run streaming. */
export interface RunSocketEvents {
  // client -> server
  'run:subscribe': (payload: { runId: string }) => void
  'run:unsubscribe': (payload: { runId: string }) => void
  'relay': (payload: { room: string; event: string; data: unknown }) => void
  // server -> client (broadcast to room run:<runId>)
  'run:started': (payload: { runId: string; workflowId: string }) => void
  'step:started': (payload: { runId: string; stepId: string; kind: StepKind; label: string; order: number }) => void
  'step:progress': (payload: { runId: string; stepId: string; message: string }) => void
  'step:completed': (payload: {
    runId: string
    stepId: string
    kind: StepKind
    status: RunStepStatus
    output?: unknown
    aiTokens?: number
    aiCostCents?: number
  }) => void
  'run:report': (payload: { runId: string; report: RunReport; stats: { itemsProcessed: number; automaticCount: number; flaggedCount: number; aiCallsUsed: number; aiCallsSaved: number; durationMs: number } }) => void
  'run:completed': (payload: { runId: string; status: RunStatus }) => void
}
