import { NextResponse } from 'next/server'

// GET /api/dev/docs — static JSON: MCP quickstart + reference content for the
// in-app docs page. Includes:
//   - The MCP server install (npx apical-mcp + Cursor + Claude Desktop config)
//   - The 11 full-loop tools (search registry, schema, validate, deploy,
//     generate, list/get workflows, run, run status, rerun, usage)
//   - The /v1 REST API endpoints with curl examples
//   - The AutomationFile format summary + a link to /api/dev/schema
//   - Pricing/plans summary
export async function GET() {
  try {
    return NextResponse.json(DOCS)
  } catch (err) {
    console.error('[api/dev/docs] failed:', err)
    return NextResponse.json(
      { error: 'Failed to build docs.' },
      { status: 500 },
    )
  }
}

const DOCS = {
  title: 'Apical Developer Platform',
  tagline:
    'Deploy + run AI agents from your editor (MCP) or your own code (REST).',
  // ─────────────────────────── MCP server ───────────────────────────
  mcp: {
    name: 'apical-mcp',
    install: 'npx apical-mcp',
    description:
      'The Apical MCP server exposes your workspace as 11 tools covering the full loop — search the registry, fetch the schema, validate, deploy, generate, run (+wait), tail status, rerun, and check usage. Authenticate with a workspace API key.',
    configs: {
      cursor: {
        label: 'Cursor',
        file: '~/.cursor/mcp.json',
        snippet: {
          mcpServers: {
            apical: {
              command: 'npx',
              args: ['-y', 'apical-mcp'],
              env: {
                APICAL_API_KEY: 'ap_sk_...',
              },
            },
          },
        },
      },
      'claude-desktop': {
        label: 'Claude Desktop',
        file: '~/Library/Application Support/Claude/claude_desktop_config.json (macOS) or %APPDATA%\\Claude\\claude_desktop_config.json (Windows)',
        snippet: {
          mcpServers: {
            apical: {
              command: 'npx',
              args: ['-y', 'apical-mcp'],
              env: {
                APICAL_API_KEY: 'ap_sk_...',
              },
            },
          },
        },
      },
    },
    tools: [
      {
        name: 'apical_search_registry',
        description:
          'Search the connector registry + installed integrations. Returns integration ids to reference in workflow steps.',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
        },
      },
      {
        name: 'apical_get_schema',
        description:
          'Fetch the WorkflowJSON v2 JSON Schema (the contract every workflow document must satisfy).',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'apical_validate',
        description:
          'Validate a WorkflowJSON document without saving: schema, step ids, {{stepId.field}} refs, integration + credential refs.',
        inputSchema: {
          type: 'object',
          required: ['workflow'],
          properties: { workflow: { type: 'object' } },
        },
      },
      {
        name: 'apical_deploy',
        description:
          'Create a workflow from a WorkflowJSON v2 document. Validated first — fails with the issue list if invalid.',
        inputSchema: {
          type: 'object',
          required: ['name', 'workflow'],
          properties: {
            name: { type: 'string' },
            workflow: { type: 'object' },
            description: { type: 'string' },
          },
        },
      },
      {
        name: 'apical_generate',
        description:
          'Natural-language spec → Apical designs, validates, and saves a draft workflow. Blocks until the job finishes.',
        inputSchema: {
          type: 'object',
          required: ['spec'],
          properties: { spec: { type: 'string' }, name: { type: 'string' } },
        },
      },
      {
        name: 'apical_list_workflows',
        description: 'List the workspace\'s workflows (name, status, run count, id).',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'apical_get_workflow',
        description: 'One workflow\'s detail — steps, schedule, run stats.',
        inputSchema: {
          type: 'object',
          required: ['workflowId'],
          properties: { workflowId: { type: 'string' } },
        },
      },
      {
        name: 'apical_run',
        description:
          'Trigger a run. wait=true (default) blocks up to 60s and returns the report. Costs 3¢. Supports idempotencyKey.',
        inputSchema: {
          type: 'object',
          required: ['workflowId'],
          properties: {
            workflowId: { type: 'string' },
            wait: { type: 'boolean' },
            idempotencyKey: { type: 'string' },
          },
        },
      },
      {
        name: 'apical_run_status',
        description:
          'Tail a run: status, per-step progress + errors, and the report once finished.',
        inputSchema: {
          type: 'object',
          required: ['runId'],
          properties: { runId: { type: 'string' } },
        },
      },
      {
        name: 'apical_rerun',
        description:
          'Re-execute a failed run as a new run from the failed step (or an explicit fromStepId).',
        inputSchema: {
          type: 'object',
          required: ['runId'],
          properties: { runId: { type: 'string' }, fromStepId: { type: 'string' } },
        },
      },
      {
        name: 'apical_usage',
        description: 'Workspace balance, plan, run counts, per-key spend vs limits.',
        inputSchema: {
          type: 'object',
          properties: { days: { type: 'number' } },
        },
      },
    ],
  },

  // ─────────────────────────── REST API ───────────────────────────
  rest: {
    baseUrl: '/v1',
    auth: {
      type: 'bearer',
      header: 'Authorization: Bearer ap_sk_...',
      altHeader: 'x-apical-key: ap_sk_...',
      note: 'Authenticate every request with your workspace API key in the Authorization header (or x-apical-key). Keys carry scopes and optional spend limits. Never commit your key. Legacy /api/dev endpoints still work but /v1 is the supported surface.',
    },
    endpoints: [
      {
        method: 'GET',
        path: '/v1/registry/integrations?q=slack',
        description: 'Search the connector registry + installed integrations.',
        curl: `curl "https://your-app.example.com/v1/registry/integrations?q=slack" \\
  -H "Authorization: Bearer ap_sk_..."`,
      },
      {
        method: 'POST',
        path: '/v1/workflows/validate',
        description: 'Validate a WorkflowJSON document without saving.',
        curl: `curl -X POST https://your-app.example.com/v1/workflows/validate \\
  -H "Authorization: Bearer ap_sk_..." \\
  -H "Content-Type: application/json" \\
  -d '{"workflow":{"version":2,"steps":[...]}}'`,
      },
      {
        method: 'POST',
        path: '/v1/workflows',
        description: 'Create a workflow from a WorkflowJSON v2 document (validated first).',
        curl: `curl -X POST https://your-app.example.com/v1/workflows \\
  -H "Authorization: Bearer ap_sk_..." \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Scan filing","workflow":{"version":2,"steps":[...]}}'`,
      },
      {
        method: 'POST',
        path: '/v1/workflows/generate',
        description: 'Natural-language spec → draft workflow (async; poll the returned jobId).',
        curl: `curl -X POST https://your-app.example.com/v1/workflows/generate \\
  -H "Authorization: Bearer ap_sk_..." \\
  -H "Content-Type: application/json" \\
  -d '{"spec":"Every morning, list new PDFs in the scans folder and file them by client"}'`,
      },
      {
        method: 'GET',
        path: '/v1/workflows',
        description: 'List your workflows.',
        curl: `curl https://your-app.example.com/v1/workflows \\
  -H "Authorization: Bearer ap_sk_..."`,
      },
      {
        method: 'POST',
        path: '/v1/workflows/{id}/run?wait=true',
        description: 'Trigger a run (3¢). wait=true blocks up to 60s and returns the report. Supports Idempotency-Key header.',
        curl: `curl -X POST "https://your-app.example.com/v1/workflows/wf_sorter/run?wait=true" \\
  -H "Authorization: Bearer ap_sk_..." \\
  -H "Idempotency-Key: my-key-123"`,
      },
      {
        method: 'GET',
        path: '/v1/runs/{id}',
        description: 'Run status, per-step progress + errors, and the report.',
        curl: `curl https://your-app.example.com/v1/runs/run_1 \\
  -H "Authorization: Bearer ap_sk_..."`,
      },
      {
        method: 'POST',
        path: '/v1/runs/{id}/rerun',
        description: 'Re-execute a failed run from the failed step (optional fromStepId).',
        curl: `curl -X POST https://your-app.example.com/v1/runs/run_1/rerun \\
  -H "Authorization: Bearer ap_sk_..."`,
      },
      {
        method: 'GET',
        path: '/v1/usage?days=30',
        description: 'Balance, plan, run counts, per-key spend vs limits.',
        curl: `curl "https://your-app.example.com/v1/usage?days=30" \\
  -H "Authorization: Bearer ap_sk_..."`,
      },
    ],
  },

  // ─────────────────────────── Automation File ───────────────────────────
  automationFile: {
    description:
      'A single JSON object that fully describes an agent: its name, trigger, inline integrations, inline credentials, and a list of tool/reason/gate steps. Drop it on the chat, POST it to /api/dev/deploy, or pass it to the MCP `deploy` tool.',
    schemaUrl: '/api/dev/schema',
    schemaNote:
      'The full field-by-field schema (with descriptions, required badges, nested sub-tables for steps/integrations/credentials, and a complete worked example) is at /api/dev/schema.',
    topFields: [
      { name: 'name', type: 'string', required: true, description: 'Agent name.' },
      { name: 'description', type: 'string', required: false, description: 'One-sentence role.' },
      { name: 'trigger', type: 'object', required: false, description: "{ type: 'manual'|'schedule', cron?, label? }" },
      { name: 'integrations', type: 'array', required: false, description: 'Inline integrations to install.' },
      { name: 'mcpServers', type: 'array', required: false, description: 'Shorthand for MCP servers (each becomes an Integration).' },
      { name: 'credentials', type: 'array', required: false, description: 'Inline credentials for the vault.' },
      { name: 'steps', type: 'array', required: true, description: 'List of { id, kind: tool|reason|gate, ... }.' },
    ],
    minimalExample: {
      name: 'Scanner Filing',
      steps: [
        { id: 's1', kind: 'tool', label: 'List files', tool: 'files.list', inputs: { folder: '/Inbox' } },
        { id: 's2', kind: 'reason', label: 'Classify', prompt: 'Determine which client this file belongs to.', outputShape: { client: 'string' } },
        { id: 's3', kind: 'gate', label: 'Approve', gateMessage: 'Confirm before filing.' },
        { id: 's4', kind: 'tool', label: 'File', tool: 'files.move', inputs: { file: '{{s1.files[]}}', dest: '/Clients/{{s2.client}}/' } },
      ],
    },
  },

  // ─────────────────────────── Pricing ───────────────────────────
  pricing: {
    currency: 'USD',
    note: 'Prepaid credits. Runs deduct from your balanceCents. Top up anytime; no auto-charge in this demo.',
    plans: [
      {
        id: 'free',
        name: 'Free',
        priceCents: 0,
        period: 'month',
        credits: '$5 starting credit',
        features: ['1 workspace', 'Up to 3 agents', 'Manual + schedule triggers', 'Community support'],
      },
      {
        id: 'starter',
        name: 'Starter',
        priceCents: 1900,
        period: 'month',
        credits: '$20 credits/mo included',
        features: ['3 workspaces', 'Up to 25 agents', 'REST + MCP access', 'Email support'],
      },
      {
        id: 'pro',
        name: 'Pro',
        priceCents: 4900,
        period: 'month',
        credits: '$60 credits/mo included',
        features: ['Unlimited workspaces', 'Unlimited agents', 'Audit log export', 'Priority support'],
        popular: true,
      },
      {
        id: 'scale',
        name: 'Scale',
        priceCents: 19900,
        period: 'month',
        credits: '$300 credits/mo included',
        features: ['Everything in Pro', 'SSO + SAML', 'Dedicated support engineer', 'Custom rate for high-volume runs'],
      },
    ],
    perRunCostCents: 3,
    freeActions: ['deploy', 'list_agents', 'get_agent', 'get_report', 'billing reads'],
  },
}
