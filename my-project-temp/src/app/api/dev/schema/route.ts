import { NextResponse } from 'next/server'

// GET /api/dev/schema — the Apical Automation File JSON schema, with field
// descriptions and a complete worked example (the scanner PDF sorter hire).
// Powers the developer-mode "JSON schema" reference page.
export async function GET() {
  try {
    return NextResponse.json(SCHEMA_DOC)
  } catch (err) {
    console.error('[api/dev/schema] failed:', err)
    return NextResponse.json(
      { error: 'Failed to build schema doc' },
      { status: 500 },
    )
  }
}

const SCHEMA_DOC = {
  format: 'apical-automation-file',
  version: 1,
  description:
    'A single JSON file you can drop onto the chat (or POST to /api/employees/import) to hire an employee complete with their tools, credentials, and a tool/reason/gate workflow. Inline integrations are installed as private integrations; inline credentials land in the AI-auth vault. Department + title place the hire in the right room.',
  fields: {
    $schema: {
      type: 'string (optional)',
      description: 'Optional schema URL hint. Ignored by the importer.',
    },
    name: {
      type: 'string (required)',
      description:
        "The employee's first name — friendly, like 'Pat' or 'Sam'. Required.",
    },
    description: {
      type: 'string (optional)',
      description: 'One-sentence description of what this hire does.',
    },
    department: {
      type:
        "'reception' | 'filing' | 'mailroom' | 'finance' | 'dispatch' (optional, default 'reception')",
      description: 'Which room this hire works in.',
    },
    title: {
      type: 'string (optional)',
      description: "Plain role title, e.g. 'Filing Clerk', 'Bookkeeper'.",
    },
    trigger: {
      type: 'object (optional)',
      description:
        "How the hire is triggered. { type: 'manual' | 'schedule', cron?: string, label?: string }.",
      fields: {
        type: "'manual' | 'schedule' (default 'manual')",
        cron: 'string (optional) — cron expression for schedule triggers',
        label:
          "string (optional) — human-readable schedule like 'Every weekday at 9:00am'. Stored on the workflow.",
      },
    },
    integrations: {
      type: 'array (optional)',
      description:
        "Inline integration definitions to install as private integrations. Each becomes an Integration row.",
      itemFields: {
        id: 'string — local id (kept in the file; not stored)',
        name: 'string (required) — display name',
        kind: "'mcp' | 'api' | 'http'",
        specUrl: 'string (optional) — OpenAPI spec URL',
        url: 'string (optional) — base URL or MCP transport',
        description: 'string (optional)',
        category:
          "'files' | 'email' | 'messaging' | 'finance' | 'documents' | 'database' | 'general'",
        visibility: "'private' | 'public' (default 'private')",
        auth:
          "{ type: 'oauth' | 'apikey' | 'basic' | 'none' | 'mcp_token', ref?: string } — ref points into the credentials vault",
        tools:
          'array of { id, name, description } — tool ids are namespaced like "notion.queryDatabase". If omitted, plausible tools are auto-generated from the integration name.',
      },
    },
    credentials: {
      type: 'array (optional)',
      description:
        'Inline credential declarations to install into the AI-auth vault.',
      itemFields: {
        service: 'string (required) — e.g. "gmail", "stripe"',
        label: 'string (optional) — human label',
        kind: "'oauth' | 'apikey' | 'payment' | 'mcp_token'",
        ref: 'string (optional) — local ref name; matches integration.auth.ref',
        meta:
          'object (optional) — non-secret metadata, e.g. { scopes, account, last4 }. If meta.status is "provisioning", the credential lands in the provisioning state.',
      },
    },
    steps: {
      type: 'array (required)',
      description:
        'The workflow — a list of steps. Each step has a `kind`: "tool" (mechanical), "reason" (judgment), or "gate" (human approval). At least one step is required. Tool steps may also carry an inline `http` spec — when present, the runtime executes the raw HTTP call directly (no named tool required) and `tool` becomes optional.',
      itemFields: {
        id: 'string — step id (s1, s2, ...). Referenced by later steps via {{stepId.field}}.',
        kind: "'tool' | 'reason' | 'gate'",
        label: 'string — short human label',
        tool:
          'string (tool steps only, optional when `http` is present) — tool id from the catalog, e.g. "files.list"',
        inputs:
          'object (tool steps only) — may reference earlier outputs as {{s1.files}}',
        http:
          'object (tool steps only, optional) — inline raw HTTP call. When present, the runtime makes this request directly. Shape: { method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE", url: string, headers?: Record<string,string>, body?: any, auth?: { type: "bearer"|"apikey_header"|"basic"|"none", ref?: string (vault cred id), headerName?: string (for apikey_header) }, description?: string }. URL, headers, and body may all use {{stepId.field}} refs to earlier step outputs + {{cred:service.field}} refs to pull secrets from the vault at runtime.',
        prompt:
          'string (reason steps only) — the prompt the model reasons over',
        allowedTools:
          'array of tool ids (reason steps only) — tools the model may call while reasoning',
        outputShape:
          'object (reason steps only) — field→type, e.g. { client: "string", confidence: "number" }',
        confidenceThreshold:
          'number 0-1 (reason steps only) — runs below this confidence flag for review',
        gateMessage:
          'string (gate steps only) — what the human is approving',
        hardened:
          'boolean (optional) — marks a step as already hardened from reason→tool',
        rule: 'string (optional) — the deterministic rule applied when hardened',
        note: 'string (optional) — note shown in the UI',
      },
    },
    mcpServers: {
      type: 'array (optional, shorthand)',
      description:
        "MCP servers to connect (each becomes an Integration with kind='mcp'). Shortcut for declaring MCP integrations inline without writing the full integration object. Each item: { name, transport: 'stdio'|'http', command?, args?, env?, url? } — same shape as McpServerConfig plus a name.",
      itemFields: {
        name: 'string (required) — display name for the resulting integration',
        transport: "'stdio' | 'http'",
        command: 'string (stdio only) — executable to spawn',
        args: 'array of strings (stdio only) — command-line args',
        env: 'object (stdio only) — environment variables',
        url: 'string (http only) — MCP server URL',
      },
    },
  },
  example: {
    $schema: 'https://apic.al/schemas/automation-file.json',
    name: 'Pat',
    title: 'Filing Clerk',
    department: 'filing',
    description:
      'Watches the scanner inbox, figures out which client each PDF belongs to, and files it. Asks before moving anything uncertain.',
    trigger: { type: 'schedule', label: 'Every 30 minutes' },
    integrations: [
      {
        id: 'scanner',
        name: 'Scanner Watch',
        kind: 'mcp',
        url: 'stdio://scanner-mcp',
        category: 'files',
        auth: { type: 'none' },
        tools: [
          { id: 'scanner.listNew', name: 'List new scans', description: 'List scans not yet processed.' },
          { id: 'scanner.markProcessed', name: 'Mark processed', description: 'Mark a scan as handled.' },
        ],
      },
      {
        id: 'ocr',
        name: 'Document OCR',
        kind: 'mcp',
        url: 'stdio://doc-ocr-mcp',
        category: 'documents',
        auth: { type: 'none' },
        tools: [
          { id: 'ocr.extract', name: 'Extract text', description: 'OCR-extract text from a document.' },
          { id: 'ocr.classify', name: 'Classify document', description: 'Classify a document by type.' },
        ],
      },
      {
        id: 'files',
        name: 'Local Filesystem',
        kind: 'http',
        url: 'http://127.0.0.1:7777',
        category: 'files',
        auth: { type: 'apikey', ref: 'cred_local_daemon' },
        tools: [
          { id: 'files.list', name: 'List folder', description: 'List files in a folder.' },
          { id: 'files.move', name: 'Move file', description: 'Move a file to a destination folder.' },
        ],
      },
    ],
    credentials: [
      {
        service: 'local-daemon',
        label: 'Local agent daemon key',
        kind: 'apikey',
        ref: 'cred_local_daemon',
        meta: { machine: 'this-machine' },
      },
    ],
    // mcpServers shorthand — each becomes an Integration with kind='mcp'.
    mcpServers: [
      {
        name: 'Notifications MCP',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-notifications'],
      },
    ],
    steps: [
      { id: 's1', kind: 'tool', label: 'List new scans', tool: 'scanner.listNew', inputs: { folder: '/Scan Inbox' }, note: 'Polls the scanner for unprocessed files.' },
      { id: 's2', kind: 'tool', label: 'Extract text', tool: 'ocr.extract', inputs: { file: '{{s1.files[]}}' }, note: 'OCR each new scan.' },
      { id: 's3', kind: 'reason', label: 'Classify client', prompt: 'Determine which client this scanned document belongs to. Return the client name, document type, and confidence (0-1).', allowedTools: ['ocr.classify'], outputShape: { client: 'string', documentType: 'string', confidence: 'number' }, confidenceThreshold: 0.8 },
      { id: 's4', kind: 'gate', label: 'Confirm low-confidence', gateMessage: 'Not sure which client — please confirm before filing.', note: 'Only fires when the classifier is unsure.' },
      { id: 's5', kind: 'tool', label: 'File in client folder', tool: 'files.move', inputs: { file: '{{s1.files[]}}', dest: '/Clients/{{s3.client}}/' } },
      { id: 's6', kind: 'tool', label: 'Mark processed', tool: 'scanner.markProcessed', inputs: { file: '{{s1.files[]}}' } },
      // Inline http step — no named tool, the runtime makes the call directly.
      {
        id: 's7',
        kind: 'tool',
        label: 'Webhook notify filing complete',
        note: 'Sends a webhook to a public endpoint when the batch finishes. URL + headers can use {{s1.x}} and {{cred:service.field}} refs.',
        http: {
          method: 'POST',
          url: 'https://hooks.example.com/filing-complete',
          headers: { 'Content-Type': 'application/json', 'X-Api-Key': '{{cred:example-com.api_key}}' },
          body: { batchCount: '{{s1.files}}', flaggedCount: '{{s4.flagged}}', agent: 'Pat' },
          auth: { type: 'apikey_header', ref: 'cred_example-com', headerName: 'X-Api-Key' },
          description: 'Notify an external webhook that the filing batch completed.',
        },
      },
    ],
  },
}
