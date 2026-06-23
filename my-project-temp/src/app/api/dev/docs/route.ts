import { NextResponse } from 'next/server'

// GET /api/dev/docs — static JSON: MCP quickstart + reference content for the
// in-app docs page. Includes:
//   - The MCP server install (npx apical-mcp + Cursor + Claude Desktop config)
//   - The 5 tools (deploy, list_agents, get_agent, run_agent, get_report) with
//     input/output schemas
//   - The REST API endpoints (deploy, run, agents, reports) with curl examples
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
      'The Apical MCP server exposes your developer account as 5 tools you can call from any MCP-aware client. Authenticate with an API key (create one in the console).',
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
        name: 'deploy',
        description:
          'Deploy an Automation File (a JSON description of an agent + its tools + credentials). Creates inline integrations + credentials + the workflow in one shot.',
        inputSchema: {
          type: 'object',
          required: ['automationFile'],
          properties: {
            automationFile: {
              type: 'object',
              description: 'The AutomationFile JSON. See /api/dev/schema for the full schema.',
              required: ['name', 'steps'],
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                department: { type: 'string' },
                title: { type: 'string' },
                integrations: { type: 'array' },
                credentials: { type: 'array' },
                mcpServers: { type: 'array' },
                steps: { type: 'array' },
              },
            },
          },
        },
        outputSchema: {
          type: 'object',
          properties: {
            agent: { type: 'object', description: 'The created Workflow.' },
            integrationsCreated: { type: 'number' },
            credentialsCreated: { type: 'number' },
          },
        },
      },
      {
        name: 'list_agents',
        description: 'List the agents (workflows) in your workspace.',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: {
          type: 'array',
          items: { type: 'object', description: 'A Workflow.' },
        },
      },
      {
        name: 'get_agent',
        description: 'Get one agent (workflow) by id, with its execution patterns.',
        inputSchema: {
          type: 'object',
          required: ['agentId'],
          properties: { agentId: { type: 'string' } },
        },
        outputSchema: {
          type: 'object',
          description: 'The Workflow + a patterns array.',
        },
      },
      {
        name: 'run_agent',
        description:
          'Trigger a run on an agent. Costs 3¢ from your balance. Returns a runId immediately; the run streams progress over the relay (subscribe via socket.io).',
        inputSchema: {
          type: 'object',
          required: ['agentId'],
          properties: { agentId: { type: 'string' } },
        },
        outputSchema: {
          type: 'object',
          properties: {
            runId: { type: 'string' },
            status: { type: 'string', enum: ['running'] },
          },
        },
      },
      {
        name: 'get_report',
        description:
          'Get the full run report: status, items processed, flagged items, step outputs.',
        inputSchema: {
          type: 'object',
          required: ['runId'],
          properties: { runId: { type: 'string' } },
        },
        outputSchema: {
          type: 'object',
          properties: { run: { type: 'object', description: 'The Run.' } },
        },
      },
    ],
  },

  // ─────────────────────────── REST API ───────────────────────────
  rest: {
    baseUrl: '/api/dev',
    auth: {
      type: 'bearer',
      header: 'Authorization: Bearer ap_sk_...',
      altHeader: 'x-apical-key: ap_sk_...',
      note: 'Authenticate every request with your API key in the Authorization header (or x-apical-key). Never commit your key.',
    },
    endpoints: [
      {
        method: 'POST',
        path: '/api/dev/deploy',
        description: 'Deploy an Automation File.',
        curl: `curl -X POST https://your-app.example.com/api/dev/deploy \\
  -H "Authorization: Bearer ap_sk_..." \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Pat","title":"Filing Clerk","steps":[{"id":"s1","kind":"tool","label":"List files","tool":"files.list"}]}'`,
      },
      {
        method: 'POST',
        path: '/api/dev/run',
        description: 'Trigger a run on an agent. Costs 3¢.',
        curl: `curl -X POST https://your-app.example.com/api/dev/run \\
  -H "Authorization: Bearer ap_sk_..." \\
  -H "Content-Type: application/json" \\
  -d '{"agentId":"wf_sorter"}'`,
      },
      {
        method: 'GET',
        path: '/api/dev/agents',
        description: 'List your agents.',
        curl: `curl https://your-app.example.com/api/dev/agents \\
  -H "Authorization: Bearer ap_sk_..."`,
      },
      {
        method: 'GET',
        path: '/api/dev/agents/{id}',
        description: 'Get one agent (with patterns).',
        curl: `curl https://your-app.example.com/api/dev/agents/wf_sorter \\
  -H "Authorization: Bearer ap_sk_..."`,
      },
      {
        method: 'GET',
        path: '/api/dev/reports/{runId}',
        description: 'Get the run report + steps.',
        curl: `curl https://your-app.example.com/api/dev/reports/run_1 \\
  -H "Authorization: Bearer ap_sk_..."`,
      },
      {
        method: 'GET',
        path: '/api/dev/account',
        description: 'Your account (plan, balance).',
        curl: `curl https://your-app.example.com/api/dev/account \\
  -H "Authorization: Bearer ap_sk_..."`,
      },
      {
        method: 'GET',
        path: '/api/dev/usage?days=30',
        description: 'Usage stats for the dashboard.',
        curl: `curl "https://your-app.example.com/api/dev/usage?days=30" \\
  -H "Authorization: Bearer ap_sk_..."`,
      },
      {
        method: 'GET',
        path: '/api/dev/logs?limit=50',
        description: 'Audit log (newest first).',
        curl: `curl "https://your-app.example.com/api/dev/logs?limit=50" \\
  -H "Authorization: Bearer ap_sk_..."`,
      },
    ],
  },

  // ─────────────────────────── Automation File ───────────────────────────
  automationFile: {
    description:
      'A single JSON object that fully describes an agent: its name, department, trigger, inline integrations, inline credentials, and a list of tool/reason/gate steps. Drop it on the chat, POST it to /api/dev/deploy, or pass it to the MCP `deploy` tool.',
    schemaUrl: '/api/dev/schema',
    schemaNote:
      'The full field-by-field schema (with descriptions, required badges, nested sub-tables for steps/integrations/credentials, and a complete worked example) is at /api/dev/schema.',
    topFields: [
      { name: 'name', type: 'string', required: true, description: 'Agent name.' },
      { name: 'description', type: 'string', required: false, description: 'One-sentence role.' },
      { name: 'department', type: 'string', required: false, description: 'Free-form group label.' },
      { name: 'title', type: 'string', required: false, description: 'Role title.' },
      { name: 'trigger', type: 'object', required: false, description: "{ type: 'manual'|'schedule', cron?, label? }" },
      { name: 'integrations', type: 'array', required: false, description: 'Inline integrations to install.' },
      { name: 'mcpServers', type: 'array', required: false, description: 'Shorthand for MCP servers (each becomes an Integration).' },
      { name: 'credentials', type: 'array', required: false, description: 'Inline credentials for the vault.' },
      { name: 'steps', type: 'array', required: true, description: 'List of { id, kind: tool|reason|gate, ... }.' },
    ],
    minimalExample: {
      name: 'Pat',
      title: 'Filing Clerk',
      department: 'Filing',
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
