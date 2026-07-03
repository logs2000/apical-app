# apical-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets your AI coding agent (Cursor, Claude Code, Claude Desktop, Windsurf) **design, validate, deploy, and run Apical automations** straight from your editor.

Apical is "Cursor for office work" — an AI agent platform where you describe a repetitive job and it runs on a schedule. With `apical-mcp`, the agent you're already pair-programming with covers the full loop: search the connector registry, fetch the WorkflowJSON schema, validate a document, deploy it, trigger a run (sync or async), tail its status, read the report, rerun from a failed step, and check usage/spend — without you leaving the editor.

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

1. Open Apical: **Settings → API Keys**.
2. Create a workspace API key. It starts with `ap_sk_...`. Give it at least the scopes `workflows:read`, `workflows:write`, `runs:execute`, `runs:read`, `registry:read`, `usage:read` (or leave scopes empty for all).
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

After saving, restart Cursor. You should see `apical` show up under **Settings → MCP** with 11 tools available.

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

The server exposes 11 tools covering the full loop. Your AI agent decides when to call them — you just chat naturally ("build me an automation that files scans", "run the invoice workflow and show me the report").

| Tool | What it does | Backing endpoint |
| --- | --- | --- |
| `apical_search_registry` | Search connectors + installed integrations (get ids for workflow steps). | `GET /v1/registry/integrations?q=` |
| `apical_get_schema` | Fetch the WorkflowJSON v2 JSON Schema (the contract). | `GET /schemas/workflow/v2.json` |
| `apical_validate` | Validate a WorkflowJSON document without saving. | `POST /v1/workflows/validate` |
| `apical_deploy` | Create a workflow from a validated WorkflowJSON document. | `POST /v1/workflows` |
| `apical_generate` | Natural-language spec → designed, validated draft workflow (blocks until done). | `POST /v1/workflows/generate` |
| `apical_list_workflows` | List the workspace's workflows. | `GET /v1/workflows` |
| `apical_get_workflow` | One workflow's steps + stats. | `GET /v1/workflows/{id}` |
| `apical_run` | Trigger a run; `wait=true` (default) blocks up to 60s and returns the report. Supports `idempotencyKey`. | `POST /v1/workflows/{id}/run?wait=true` |
| `apical_run_status` | Tail a run: status, per-step progress + errors, report. | `GET /v1/runs/{id}` |
| `apical_rerun` | Re-execute a failed run from the failed step (or `fromStepId`). | `POST /v1/runs/{id}/rerun` |
| `apical_usage` | Balance, plan, run counts, per-key spend vs limits. | `GET /v1/usage` |

### The typical loop

1. `apical_search_registry("slack")` → find integration ids.
2. `apical_get_schema` → read the WorkflowJSON v2 contract (or skip and use `apical_generate`).
3. `apical_validate({ workflow })` → fix issues until `VALID ✓`.
4. `apical_deploy({ name, workflow })` → get the workflow id.
5. `apical_run({ workflowId })` → blocks and returns the report; on failure inspect with `apical_run_status`, patch, then `apical_rerun`.
6. `apical_usage` → keep an eye on spend.

### `apical_deploy` payload

The `workflow` argument is a **WorkflowJSON v2** document (see `apical_get_schema`; examples at `/schemas/workflow/examples/`):

```json
{
  "name": "Scan filing",
  "workflow": {
    "version": 2,
    "steps": [
      { "id": "s1", "kind": "tool", "label": "List new scans", "code": { "language": "shell", "source": "ls ~/Scans/inbox" }, "hardened": true },
      { "id": "s2", "kind": "reason", "label": "Classify client", "prompt": "Which client does {{s1.output}} belong to?", "confidenceThreshold": 0.8 },
      { "id": "s3", "kind": "gate", "label": "Confirm low-confidence filings" }
    ]
  }
}
```

**Returns:** `Deployed "Scan filing". Workflow ID: wfl_abc123` (plus any credential warnings).

---

## Error handling

Every tool call returns a plain-text message — even on error — so your AI agent sees the same shape and can react:

| Situation | Returned text |
| --- | --- |
| Wrong API key (HTTP 401) | `Invalid API key` |
| Out of credits / key spend limit (HTTP 402) | The API's refusal reason (e.g. `API key spend limit reached (300/300¢)`) |
| Key missing a scope (HTTP 403) | `Missing required scope: runs:execute` |
| Validation failure (HTTP 422) | The error plus the issue list, one per line |
| Other 4xx/5xx | The API's error message |
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
   apical-mcp  ───── HTTP ─────►  Apical /v1 API
                                    GET  /v1/registry/integrations
                                    POST /v1/workflows/validate
                                    POST /v1/workflows
                                    POST /v1/workflows/generate
                                    GET  /v1/workflows(/{id})
                                    POST /v1/workflows/{id}/run
                                    GET  /v1/runs/{id}
                                    POST /v1/runs/{id}/rerun
                                    GET  /v1/usage
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
