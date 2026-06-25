# apical-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets your AI coding agent (Cursor, Claude Code, Claude Desktop, Windsurf) **deploy and run Apical automations** straight from your editor.

Apical is "Cursor for office work" — an AI agent platform where you describe a repetitive job and it runs on a schedule. With `apical-mcp`, the agent you're already pair-programming with can ship a workflow file to Apical, trigger a run, and read back the report — without you leaving the editor.

---

## Install

### From npm (when published)

```bash
npm install -g apical-mcp
# or
bun add -g apical-mcp
```

### From source (this repo)

```bash
cd mini-services/apical-mcp
bun install
# Run directly:
bun run index.ts
# Or link globally:
bun link
```

You'll need a recent Node.js or Bun. The server uses stdio for transport — your MCP client spawns it as a child process.

### Get your API key

1. Open the **Apical Developer Console** (in the Apical app: Settings → Developer).
2. Create an API key. It starts with `ap_sk_...`.
3. Put it in the `APICAL_API_KEY` env var in your MCP client config (below).

---

## Configure your client

All clients use the same shape: spawn `apical-mcp`, pass your key in the env, optionally point at a self-hosted Apical instance via `APICAL_API_URL` (default `http://localhost:3000`).

### Cursor

`.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "apical": {
      "command": "npx",
      "args": ["apical-mcp"],
      "env": {
        "APICAL_API_KEY": "ap_sk_your_key_here"
      }
    }
  }
}
```

Or, if you installed from source with Bun:

```json
{
  "mcpServers": {
    "apical": {
      "command": "bun",
      "args": ["/absolute/path/to/apical-mcp/index.ts"],
      "env": {
        "APICAL_API_KEY": "ap_sk_your_key_here",
        "APICAL_API_URL": "http://localhost:3000"
      }
    }
  }
}
```

After saving, restart Cursor. You should see `apical` show up under **Settings → MCP** with 5 tools available.

### Claude Desktop

Edit `claude_desktop_config.json` (Claude → Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "apical": {
      "command": "npx",
      "args": ["apical-mcp"],
      "env": {
        "APICAL_API_KEY": "ap_sk_your_key_here"
      }
    }
  }
}
```

Restart Claude Desktop. The Apical tools will appear under the tools menu (hammer icon).

### Claude Code (CLI)

```bash
claude mcp add apical -- npx apical-mcp
# Then export your key in the shell Claude Code runs in:
export APICAL_API_KEY=ap_sk_your_key_here
```

### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "apical": {
      "command": "npx",
      "args": ["apical-mcp"],
      "env": {
        "APICAL_API_KEY": "ap_sk_your_key_here"
      }
    }
  }
}
```

Restart Windsurf. The Apical tools appear in the MCP tools list.

### Self-hosted Apical

Add `APICAL_API_URL` to the `env` block:

```json
"env": {
  "APICAL_API_KEY": "ap_sk_...",
  "APICAL_API_URL": "https://apical.yourcompany.com"
}
```

---

## Tools

The server exposes 5 tools. Your AI agent decides when to call them — you just chat naturally ("deploy this workflow", "what are my agents?", "run the filing clerk", "show me the last report").

### 1. `apical_deploy`

Deploy an Apical automation from a workflow JSON object. The `workflow` is an [AutomationFile](https://apic.al/schemas/automation-file.json) — a single JSON that defines the agent's name, department, the inline integrations + credentials it needs, and its `steps` (the tool / reason / gate pipeline).

**Input:**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `workflow` | object | yes | An Apical AutomationFile. Must have `steps`. |
| `name` | string | no | Override `workflow.name` (the agent's first name). |
| `department` | string | no | Override `workflow.department` (e.g. "Filing"). |
| `title` | string | no | Override `workflow.title` (e.g. "Filing Clerk"). |

**Example (Cursor chat):**

> "Deploy this Apical workflow: a filing clerk that lists new scans, OCRs them, classifies the client with AI, asks me if it's unsure, then files + marks processed."

The agent assembles an AutomationFile and calls `apical_deploy`. Sample payload:

```json
{
  "workflow": {
    "name": "Pat",
    "title": "Filing Clerk",
    "department": "filing",
    "trigger": { "type": "schedule", "label": "Every 30 minutes" },
    "integrations": [
      {
        "id": "scanner",
        "name": "Scanner Watch",
        "kind": "mcp",
        "url": "stdio://scanner-mcp",
        "category": "files",
        "auth": { "type": "none" },
        "tools": [
          { "id": "scanner.listNew", "name": "List new scans", "description": "List scans not yet processed." }
        ]
      }
    ],
    "steps": [
      { "id": "s1", "kind": "tool", "label": "List new scans", "tool": "scanner.listNew", "inputs": { "folder": "/Scan Inbox" } },
      { "id": "s2", "kind": "reason", "label": "Classify client", "prompt": "Which client does this scan belong to?", "outputShape": { "client": "string", "confidence": "number" }, "confidenceThreshold": 0.8 },
      { "id": "s3", "kind": "gate", "label": "Confirm low-confidence", "gateMessage": "Not sure which client — please confirm before filing." }
    ]
  }
}
```

**Returns:** `Deployed Pat (Filing Clerk) into filing. 1 integrations installed. Agent ID: wfl_abc123`

### 2. `apical_list_agents`

List every agent you've deployed to Apical.

**Input:** `{}` (no arguments)

**Returns:**

```
Pat (Filing Clerk) — filing — active — 42 runs — id: wfl_abc123
Sam (Inbox Triage) — mailroom — active — 17 runs — id: wfl_def456
Alex (Bookkeeper) — finance — paused — 0 runs — id: wfl_ghi789
```

### 3. `apical_get_agent`

Get one agent's full workflow detail — the step list, schedule, and run stats.

**Input:**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `agentId` | string | yes | The Apical agent (workflow) id, e.g. `wfl_abc123`. |

**Returns:**

```
Pat (Filing Clerk)
Department: filing
Status: active
Schedule: Every 30 minutes
Runs: 42
Items processed: 1247

Steps:
  s1 [tool] List new scans → scanner.listNew
  s2 [reason] Classify client
  s3 [gate] Confirm low-confidence
```

### 4. `apical_run_agent`

Trigger a run of an agent immediately. The run executes asynchronously — use `apical_get_report` to poll for results.

**Input:**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `agentId` | string | yes | The Apical agent (workflow) id to run. |

**Returns:** `Started run rn_xyz789 for wfl_abc123. Status: running. Use apical_get_report to see results.`

### 5. `apical_get_report`

Get a run's report and status — the human-readable summary, the stats, and the list of flagged items.

**Input:**

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `runId` | string | yes | The Apical run id, e.g. `rn_xyz789`. |

**Returns:**

```
Status: completed
Summary: Did 47 documents, 44 automatic, 3 flagged
Stats: 47 items, 44 automatic, 3 flagged, 12.4s

Flagged items:
  • [s2] invoice_2231.pdf — confidence 0.62 below threshold 0.80
  • [s2] receipt_no_name.png — could not extract client
  • [s3] unknown_form.pdf — user confirmation pending
```

---

## Error handling

Every tool call returns a plain-text message — even on error — so your AI agent sees the same shape and can react:

| Situation | Returned text |
| --- | --- |
| Wrong API key (HTTP 401) | `Invalid API key` |
| Out of credits (HTTP 402) | `Insufficient balance` |
| Other 4xx/5xx | The API's error message (e.g. `Workflow must have at least one step`) |
| Apical app unreachable | `Could not reach Apical at http://localhost:3000 — is the app running?` |
| Missing `APICAL_API_KEY` at boot | Server exits with a clear stderr message |

---

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `APICAL_API_KEY` | yes | — | Your `ap_sk_...` developer key. |
| `APICAL_API_URL` | no | `http://localhost:3000` | Base URL of the Apical app. |

---

## How it works

```
Cursor / Claude Code / Windsurf
        │  (stdio JSON-RPC)
        ▼
   apical-mcp  ───── HTTP ─────►  Apical app
                                    POST /api/dev/deploy
                                    GET  /api/dev/agents
                                    GET  /api/dev/agents/:id
                                    POST /api/dev/run
                                    GET  /api/dev/reports/:runId
```

`apical-mcp` is a thin, stateless proxy. It holds your API key, formats requests, and renders responses as plain text your agent can read. All logs go to stderr — the JSON-RPC channel on stdout stays clean.

---

## Development

```bash
cd mini-services/apical-mcp
bun install
bun run dev          # bun --hot — auto-reloads on changes

# Smoke-test boot:
APICAL_API_KEY=ap_sk_demo_test APICAL_API_URL=http://localhost:3000 bun run index.ts
# → should print "[apical-mcp] listening on stdio, API: http://localhost:3000" to stderr
#   and then block waiting for JSON-RPC input on stdin. Ctrl-C to exit.
```

---

## License

MIT
