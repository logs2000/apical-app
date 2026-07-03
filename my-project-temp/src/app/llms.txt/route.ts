// GET /llms.txt — machine-readable orientation for LLM agents building on
// Apical. Follows the llms.txt convention (plain text, link-first).

export const dynamic = 'force-static'

const BODY = `# Apical

> Apical turns natural-language requests into deterministic, repeatable automations.
> An agent accomplishes the task once (chat-driven), then freezes the proven process
> into a WorkflowJSON document that runs on a schedule or on demand — without an
> agent in the loop. You can also author WorkflowJSON directly and deploy it via API.

## Core concepts

- Workflow: an ordered list of deterministic steps (WorkflowJSON). Steps reference
  earlier step outputs via {{stepId.field}} and vault credentials via
  {{cred:service.field}}. Secret values are never embedded in workflow documents.
- Step kinds: "tool" (deterministic call: named tool, inline http, mcp, or code),
  "reason" (bounded LLM judgment with a confidenceThreshold — low confidence flags
  the item for human review), "gate" (pause for human approval), "spawn" (delegate
  a subtask to a temporary subagent).
- Revision: every change to a workflow's steps creates an immutable WorkflowRevision.
  Runs pin the revision they executed. Rollback creates a new revision (append-only).
- Run: one execution of a workflow revision, producing per-step outputs and a report.
- AutomationFile: a portable workflow definition — steps + inline integrations +
  credential placeholders — for import/export and sharing.

## Schemas

- WorkflowJSON v2: /schemas/workflow/v2.json
- AutomationFile: /schemas/automation-file/v1.json
- Examples (complete, valid workflows): /schemas/workflow/examples/index.json

## API

Authentication: Bearer API key (Authorization: Bearer <key>). Keys are
workspace-scoped with per-key scopes and spend limits.

- POST /api/dev/deploy — deploy an AutomationFile (validates, installs inline
  integrations, creates the workflow).
- POST /api/dev/run — trigger a run ({ "agentId": "<workflowId>" }).
- GET  /api/dev/agents — list workflows in your workspace.
- GET  /api/dev/schema — the AutomationFile schema with field-by-field docs.
- GET  /api/dev/docs — full developer documentation.
- MCP server: connect via /api/mcp (Streamable HTTP) to search the registry,
  validate, deploy, and run workflows from an LLM tool loop.

## Rules for generated workflows

1. Validate against /schemas/workflow/v2.json before deploying.
2. Step ids are unique, alphanumeric with _ or -. {{stepId.field}} refs must
   target an EARLIER step.
3. Tool steps need exactly one executable spec: tool, http, mcp, or code.
4. Reason steps require a prompt; keep them narrow and set outputShape +
   confidenceThreshold so low-confidence items are flagged, not guessed.
5. Never embed secrets. Use {{cred:service.field}} and declare the credential
   placeholder in the AutomationFile "credentials" array.
6. Prefer deterministic tool steps over reason steps wherever a fixed rule works.
`

export function GET() {
  return new Response(BODY, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
