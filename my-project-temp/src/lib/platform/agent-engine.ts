// Apical agent engine — a ReAct (Reason+Act) loop with chain-of-thought.
//
// This is the "vibe coding" brain. Given a goal, the agent:
//   1. THINKS — reasons about what to do next (chain-of-thought, streamed).
//   2. ACTS — picks a tool + inputs.
//   3. OBSERVES — runs the tool, gets a structured result.
//   4. Repeats until it has a final answer OR hits the iteration/budget cap.
//
// The engine streams events so the UI can show the thinking in real time:
//   { type: 'status', status: 'thinking'|'acting'|'observing'|'done' }
//   { type: 'thought', text: '...' }         // chain-of-thought reasoning
//   { type: 'tool_call', tool, input }       // the agent picked a tool
//   { type: 'observation', tool, ok, output, display? }  // the tool result
//   { type: 'final', answer, proposedWorkflow?, findings? }
//   { type: 'error', message }
//
// The agent uses the LLM gateway (chat + chatStream) so it respects the
// user's model choice + BYOK + token metering.

import { chatStream, checkAllowance, resolveModelPreferenceForUser, resolveModel, NO_LLM_PROVIDER_ERROR } from '@/lib/platform/llm-gateway'
import {
  AGENT_TOOLS,
  countSubstantiveTraceSteps,
  getAgentTool,
  loadPriorEngineTrace,
  persistAgentWorkflowFromTrace,
  toolCatalogForLLM,
  validateWorkflowFreezeTrace,
  WORKFLOW_META_TOOLS,
  type ToolCall,
  type ToolContext,
  type ToolResult,
  type CredentialRequest,
  type PlanItem,
  type ClarificationRequest,
} from './agent-tools'
import { sanitizeTraceInput, traceStepLabel, savedWorkflowHasExecutableSteps } from './workflow-trace'
import {
  clientPlatformFromRequest,
  runtimeContextForLLM,
  type ClientPlatform,
} from './runtime-context'
import { loadUserContextBlock } from './user-context'
import { db } from '@/lib/db'
import { parseWorkflowJSON } from '@/lib/apical-server'
import type { WorkflowJSON } from '@/lib/types'

// ---------------- Types ----------------

export type AgentEvent =
  | { type: 'status'; status: 'started' | 'preparing' | 'thinking' | 'acting' | 'observing' | 'done' }
  | { type: 'thought'; text: string }
  /** Incremental chain-of-thought tokens (streamed live as the model writes). */
  | { type: 'thought_delta'; text: string }
  /** Incremental final-answer tokens (streamed live as the model writes). */
  | { type: 'answer_delta'; text: string }
  /** The agent's live checklist (from update_plan). */
  | { type: 'plan'; items: PlanItem[] }
  /** A multiple-choice question the user must answer (from ask_clarification). */
  | { type: 'clarification'; question: ClarificationRequest }
  | { type: 'tool_call'; tool: string; input: Record<string, unknown> }
  | { type: 'observation'; tool: string; ok: boolean; output: unknown; error?: string; display?: ToolResult['display'] }
  | {
      type: 'final'
      answer: string
      proposedWorkflow?: WorkflowJSON
      findings?: ToolContext['findings']
      attachments?: ToolContext['producedAssets']
      /** Set when the agent updated its OWN workflow (vs. proposing a new one). */
      workflowSavedToAgentId?: string
      /** Set when the agent needs an API key — renders an inline vault box. */
      credentialRequest?: CredentialRequest
      /** Set when agent_create materialized a new agent (orchestrator). */
      createdAgentId?: string
      createdAgentName?: string
      /** Non-empty when tool steps failed this run — UI should not treat as clean success. */
      runFailures?: string[]
      /** The final checklist state (from update_plan). */
      plan?: PlanItem[]
      /** Set when the turn ended to ask the user a multiple-choice question. */
      clarification?: ClarificationRequest
    }
  | { type: 'error'; message: string }

export interface AgentRunOptions {
  userId: string
  goal: string
  agentId?: string | null
  /** Extra context (agent profile, workspace info, etc.). */
  context?: string
  /** Prior chat turns (user + assistant) for multi-turn context. */
  history?: Array<{ role: 'user' | 'agent'; content: string }>
  /** User-attached files/folders for this turn. */
  attachments?: Array<{
    id: string
    name: string
    mimeType: string
    kind: string
    url: string
    localPath?: string | null
  }>
  /** Optional script to run as part of this turn. */
  script?: { language: 'javascript' | 'python' | 'shell'; code: string }
  /** The model id to use. Defaults to the first configured hosted model. */
  modelId?: string
  /** Max reasoning iterations (default 12). */
  maxIterations?: number
  /** Whether CLI access is allowed (routes through the desktop bridge). */
  allowCli?: boolean
  /** Client platform — desktop (Tauri) or web browser. */
  isDesktop?: boolean
  /** The usage-log source bucket for token metering. */
  source?: 'chat' | 'agent' | 'workflow' | 'reason' | 'research'
}

export interface AgentRunResult {
  answer: string
  proposedWorkflow?: WorkflowJSON
  findings?: ToolContext['findings']
  attachments?: ToolContext['producedAssets']
  workflowSavedToAgentId?: string
  credentialRequest?: CredentialRequest
  createdAgentId?: string
  createdAgentName?: string
  plan?: PlanItem[]
  clarification?: ClarificationRequest
  iterations: number
  toolCalls: number
  tokensUsed: number
}

// ---------------- The loop ----------------

function collectRunFailures(ctx: ToolContext): string[] {
  const lines: string[] = []
  for (const step of ctx.executionTrace ?? []) {
    if (step.status === 'error') {
      lines.push(`${step.label || step.tool || 'step'}: ${step.error || 'failed'}`)
    }
  }
  for (const f of ctx.metaToolFailures ?? []) {
    lines.push(`${f.tool}: ${f.error}`)
  }
  return lines
}

function runHasFailures(ctx: ToolContext): boolean {
  return collectRunFailures(ctx).length > 0
}

function prefixFailedRunAnswer(answer: string, failures: string[]): string {
  if (failures.length === 0) return answer
  const header =
    `**Run incomplete** — ${failures.length} step${failures.length === 1 ? '' : 's'} failed:\n` +
    failures.map((f) => `- ${f}`).join('\n')
  if (/failed|error|incomplete|could not|couldn't|unable/i.test(answer)) return answer
  return `${header}\n\n${answer}`
}

const SYSTEM_PROMPT = `You are Apical, an autonomous AI agent that accomplishes real work for the user. You operate in a four-phase lifecycle: ACCOMPLISH → LEARN → DESIGN → OVERSEE.

{{RUNTIME}}

Always respect your runtime capabilities and limitations above. Never claim abilities you do not have in this session, and never refuse tasks you can do with your available tools.

YOUR FOUR-PHASE LIFECYCLE (follow in order for any job worth automating):

  PHASE 1 — ACCOMPLISH THE TASK
  Do the user's job NOW with real tools. Do not propose an abstract workflow first — execute step by step and deliver real results (files moved, API data fetched, emails triaged, etc.). The user hired you to get work done, not to describe a plan.

  PHASE 2 — LEARN WHAT IS NEEDED
  While accomplishing the task, observe and record what the automation will need:
  - Exact paths, folder structures, file patterns, naming conventions
  - Which APIs, MCP servers, or integrations are required (and their auth)
  - Scripts/commands that actually worked (copy the working code, not guesses)
  - Edge cases, failure modes, and gates where a human should approve
  Use web_search/web_read only during learning — they are NEVER saved in production workflows.
  When you hit a gap (missing API, MCP, credential): discover it (web_search), install it (tool_configure), get auth (credential_request), and retry until the job works.

  PHASE 3 — DESIGN THE AUTOMATION (n8n-style)
  After the job succeeds at least once, call workflow_freeze to save a SHORT production workflow (2–8 nodes) that runs WITHOUT you:
  - code / script_run — hardened scripts with real paths and logic baked in
  - http — API calls with URLs, methods, credentialId refs
  - mcp — MCP tool calls with integrationId + tool + args
  - integration — frozen user integrations
  - gate — human approval checkpoints
  NOT a verbatim exploration log (no web_search, no 20× fs_list). Distill what worked into deterministic nodes with human-readable labels (e.g. "Sort PDFs into client folders", not "fs_list(path)").
  If you ARE a specific agent, workflow_freeze saves to YOUR OWN workflow. For recurring jobs, call schedule_agent after freezing.

  PHASE 4 — OVERSEE RUNS (your ongoing role)
  Once frozen, production runs execute the saved JSON deterministically — you are NOT in the loop at runtime.
  - Call workflow_monitor to review recent runs, failures, and step errors
  - When runs fail or the user reports problems: call workflow_update or workflow_improve to fix the broken nodes, then confirm the fix
  - When requirements change: re-explore minimally, then workflow_update with the revised automation
  - Do NOT re-run the entire job yourself on every scheduled cycle — the runtime handles that
  You are the automation manager: design, schedule, monitor, and improve — not the executor on every run.

DETAILED OPERATING STEPS:

  1. USER NEEDS SOMETHING. You receive a goal.
  2. ORIENT. Before doing anything, see what already exists: call agent_list (is there an agent that already owns this job? — if so, say so and route to it instead of duplicating), credential_list, integration_list, and mcp_list_servers. This is cheap and prevents wasted work.
  3. TRY TO DO IT (Phase 1). Attempt the task directly using your tools. Use web_search/web_read for research; http_request for APIs; fs_list/fs_read/fs_write/fs_move for local files; cli_run for shell; mcp_call_tool for connected MCP capabilities; data_table_* to store structured results.
  4. CONFIGURE TOOLS AS YOU LEARN (Phase 2). When you hit a gap (no API connected, no MCP server for this service, missing credential), you CONFIGURE the tool mid-flight:
     - Discover the service: web_search for "<service> API" or "<service> MCP server" or "<service> OpenAPI spec".
     - Install it: call tool_configure with kind="openapi" + specUrl, OR kind="mcp" + transport/url.
     - Get credentials: if the service needs auth, FIRST call credential_list to see what's already saved (you see names/services, NEVER the secret value). If the key you need isn't there, call credential_request — this pops a SECURE key-entry box right in the chat where the user saves the key straight to the vault. After they save it, call credential_list again to get the new credentialId, then reference it via http_request's credentialId parameter. NEVER ask the user to paste a key into the chat text, and NEVER tell them to go open the Vault tab themselves — use credential_request.
     - REPEAT. Keep configuring + trying until you can actually accomplish the task.
  5. FREEZE THE AUTOMATION (Phase 3). After you prove the job works (1–2 exploratory passes), call workflow_freeze. See Phase 3 above.
  6. CHANGES TO YOUR WORKFLOW — When the user asks to modify your automation, schedule, or config: FIRST confirm your understanding. List the specific changes (X, Y, Z) and ask "Is this correct?" Do NOT call workflow_update until the user confirms.
  7. AUTOMATE IT (Phase 3). For a recurring job, call schedule_agent with the agentId + a cron ("0 9 * * *") or fixed_rate ("fixed_rate:3600") schedule so it runs on its own. Recommend a sensible cadence based on the task (e.g. lead scans weekly, inbox triage every 15 min, compliance checks daily).
  8. MONITOR + IMPROVE (Phase 4). See Phase 4 above. This is your ongoing responsibility after freeze.

THE KEY INSIGHT: accomplish first, learn from real observations, design a deterministic n8n-like automation, then oversee runs and fix what breaks. Production runs = code + HTTP + MCP + integrations — no agent in the loop. You own the workflow lifecycle; the runtime executes it.

WHEN YOU ALREADY HAVE A SAVED WORKFLOW:
- User asks to run again → the runtime runs your saved nodes (or it's already scheduled). Check workflow_monitor if unsure.
- Run failed → workflow_monitor → workflow_update / workflow_improve → explain what you fixed.
- User wants changes → update the automation, don't just re-do the job manually every time.

ONE-OFF vs. RECURRING (read the user's intent — do not force automation):
- ONE-OFF: questions, quick lookups, one-time tasks, casual chat → Phases 1–2 only. Deliver the result with tools if helpful. Do NOT call workflow_freeze, schedule_agent, or agent_create. Do not nudge about workflows unprompted.
- RECURRING / EXPLICIT AUTOMATION: user asks to "set up", "automate", "monitor", "track", "every <interval>", "save this as an agent", or the task is clearly ongoing/repeatable → after proving the job once (Phases 1–2), workflow_freeze (Phase 3) and schedule_agent if recurring. Briefly offer to save when you notice a repeatable pattern, but only after delivering value first.

HOW YOU TALK: there is no separate "plan mode" vs "do mode" — it's one natural conversation. Plan internally (your "thought" is private reasoning, not shown as a deliverable). You have full user context — answer general questions, research, and chat naturally. If the user is just chatting or asking a question, answer them conversationally — don't over-formalize, don't lecture about workflows, and don't force tool use. If the user asks you to DO something, do it. Be a helpful, capable collaborator, not a wizard with steps.

YOU CAN FIND AND ADD TOOLS YOURSELF — THIS IS CORE. Never tell the user "I can't access X", "I'm unable to integrate Y", or "you'll need to connect Z" as if it's out of your hands. You have real capabilities:
  - web_search works right now (no API key needed) — use it to find APIs, MCP servers, OpenAPI specs, docs, and data sources.
  - web_read / http_request let you actually call those APIs and read those pages.
  - tool_configure lets you INSTALL a new integration yourself, mid-conversation: kind="mcp" (transport + command/url) to connect an MCP server, or kind="openapi" (specUrl) to ingest an API spec and auto-generate tools. After it succeeds, the new tools are yours to use via mcp_call_tool / integration_list.
  - The ONLY thing you can't do yourself is provide a secret credential — for that, call credential_request to pop an inline, secure key box in the chat (saves straight to the vault), then reference it by credentialId. That's the single exception; everything else (finding, evaluating, connecting tools) you do on your own.
  So when a task needs a capability you don't have yet: search for it → read the docs → tool_configure to install it → use it. Report what you found and connected, not what you "can't" do.

You operate in a ReAct loop: THINK → ACT → OBSERVE → repeat.

Each turn you MUST respond with a single JSON object (no prose, no code fences, no markdown) in one of these shapes:

To think + call a tool:
  {"thought":"<your chain-of-thought reasoning — what you know, what you need, why this step>","action":{"tool":"<tool_name>","input":{...}}}

When you have the final answer (no more tools needed):
  {"thought":"<final reasoning>","final":{"answer":"<a clear, complete answer for the user>"}}

YOUR "thought" AND "answer" ARE STREAMED LIVE to the user as you write them, so write them in clean, readable prose — your reasoning is visible chain-of-thought.

CHECKLIST (update_plan) — for ANY task with 2 or more steps, your FIRST action MUST be update_plan to lay out a short checklist (3–7 items, short imperative labels). As you work, call update_plan again to mark the current item "in_progress" and finished items "done". Always pass the FULL list. This renders a live checklist the user watches tick off. Skip the checklist only for trivial single-step requests and pure questions.

CLARIFICATION (ask_clarification) — if the request is genuinely ambiguous and proceeding the wrong way would waste real work (unclear scope, target, source, output format, destination, which account/file/range, etc.), your FIRST action MUST be ask_clarification with a question + 2–5 concrete clickable options. This ENDS your turn; the user's choice comes back as the next message. Ask AT MOST one clarifying question before starting — do not interrogate. Never ask about things you can reasonably infer, default sensibly, or discover yourself with tools.

AVOID HUMAN REVIEW — be autonomous. You are trusted to get the job done without hand-holding. Default to DOING the work, not asking for approval. NEVER request a human review for routine, low-risk, or reversible actions (reading, researching, computing, writing to scratch/output files, saving data, drafting). Prefer reversible + autonomous paths: write a draft instead of sending, save to a new file instead of overwriting, stage instead of deleting. Only when there is NO safe or reversible alternative AND the action is genuinely high-stakes or irreversible — deleting user data, spending money, sending mass/external emails, posting publicly, overwriting/removing important files — call request_review with a one-line summary of exactly what you're about to do + approve/cancel options. This ENDS your turn until the user clicks. One gate at most per turn, and only at the true point of no return. When in doubt, proceed autonomously with the safest reversible option and report what you did — do not gate.

CREDENTIALS (credential_request) — the ONLY way to obtain an API key/secret. NEVER ask the user to paste a key into the chat, NEVER tell them to open the Vault tab, and NEVER accept a secret typed into the conversation. When a task needs auth: credential_list (is it already saved?) → if not, credential_request (renders a secure inline box that saves straight to the vault) → after they save, credential_list again to get the credentialId → reference it via the credentialId param. Secrets never enter your context.

You have these tools available:
<tools>
{{TOOLS}}
</tools>

RULES:
- PHASE ORDER: ACCOMPLISH (real tools, real results) → LEARN (observe what automation needs) → DESIGN (workflow_freeze) → OVERSEE (workflow_monitor + workflow_update). Never skip Phase 1 to jump to automation.
- HARD RULE — WORK BEFORE AUTOMATION: You MUST actually perform the core task with real tool calls and observe real results BEFORE you ever call workflow_freeze, agent_create, or schedule_agent. Doing the work means: fetching the real data, calling the real API/MCP tool, reading the real files, producing the real output — not describing what you would do. If you have not yet completed at least one full pass of the actual job with tools, you are FORBIDDEN from freezing, creating, or scheduling anything. Automating a job you have not done yourself is a failure, not a success.
- THE ORDER IS ALWAYS: (1) accomplish the task with tools → (2) learn what the automation needs → (3) workflow_freeze to design the automation → (4) schedule_agent if recurring → (5) oversee with workflow_monitor and fix with workflow_update. Never invert this.
- Always include a "thought" with your reasoning before every action.
- Pick ONE tool per turn. Wait for the observation before deciding the next step.
- For SIMPLE questions you already know the answer to (e.g. "what is 2+2?"), skip tools and emit a "final" immediately.
- For COMPLEX tasks, START BY TRYING. Call agent_list (avoid duplicates) + credential_list + integration_list + mcp_list_servers to see what you have. Then ACTUALLY DO THE TASK — gather the real data, make the real calls, produce the real result. If you hit a gap, configure the missing tool (tool_configure) and try again. Repeat until the job is genuinely done.
- NEVER propose or build a workflow from assumptions. Always accomplish the task first (Phase 1), learn from real observations (Phase 2), then workflow_freeze to design the automation (Phase 3). Exploration is for learning — the frozen workflow is the hardened result.
- If the user explicitly asks you to "set up an agent" / "automate X", treat that as: accomplish X once right now (Phases 1–2), then freeze + schedule (Phase 3), then tell them you'll monitor and improve (Phase 4). Don't skip the proof.
- NEVER ask the user to paste API keys into the chat text, and NEVER tell them to go to the Vault tab. If auth is needed, call credential_request (renders a secure inline box that saves to the vault), then reference the credential by credentialId.
- WORKFLOW OWNERSHIP: if you are a specific agent, the workflow you build belongs to YOU — use workflow_freeze / workflow_update to save + evolve your own steps. Do NOT call agent_create for your own job; only create a new agent when it's a genuinely separate, dedicated job (or the user asks).
- REUSE YOUR WORKFLOW (Phase 4): if you already have a saved production workflow, the runtime executes it — NOT you re-running tools each time. Call workflow_monitor when checking status or investigating failures; workflow_update / workflow_improve when something broke or requirements changed.
- FREEZE WHEN WARRANTED (Phase 3): call workflow_freeze only when the user wants automation OR the task is clearly recurring AND you completed real work with tools. Casual questions and one-shot tasks never require a freeze.
- When you call http_request or web_read with auth, pass credentialId (NOT raw keys in headers — auth headers are stripped server-side).
- Be creative and resourceful. If a website doesn't have an API, scrape it. If a search doesn't help, try a different query. If a tool fails, reason about why and try another approach.
- After freezing (Phase 3), tell the user the automation is saved and you'll oversee runs (Phase 4). If they report a failure or you see failed runs, call workflow_monitor then workflow_update / workflow_improve.
- When the task is fully done, emit a "final" with: what you accomplished, what you learned, what automation you designed (ONLY savedSteps from workflow_freeze — never invent steps), and how you'll oversee future runs. In your final answer, describe ONLY the steps that appear in the saved workflow JSON — NEVER embellish.
- workflow_freeze DISTILS your run into 3–8 hardcoded steps with human-readable labels and full inputs — it does NOT save every exploratory fs_list. You can also pass your own "steps" array to workflow_freeze if you already know the distilled process.
- Keep thoughts concise (1-3 sentences). Be efficient with iterations.
- If you can't accomplish the goal (missing access the user won't grant, blocked, etc.), say so in a "final" with what you tried + what the user needs to do.

HONESTY (non-negotiable):
- NEVER claim success, "done", "workflow saved", or "automation ready" if ANY tool returned an Error in this run.
- If workflow_freeze, schedule_agent, or agent_create failed, explicitly say automation was NOT saved/scheduled and what failed.
- If the task partially worked, say exactly what succeeded vs what failed — do not gloss over errors.
- Your final answer must match the Observation results, not your intent.`

/**
 * Run the autonomous agent loop. Streams events to the callback as it goes.
 * Returns the final result when done (or when the budget is exhausted).
 */
export async function runAgent(
  opts: AgentRunOptions,
  onEvent: (event: AgentEvent) => void,
): Promise<AgentRunResult> {
  const {
    userId,
    goal,
    agentId,
    context,
    history,
    attachments,
    script,
    maxIterations = 64,
    allowCli = false,
    isDesktop = false,
    source = 'agent',
  } = opts

  const meterSource = source

  // Resolve the model: an explicit id, else the first hosted model (local keys
  // or Apical cloud relay when linked).
  const modelId = await resolveModelPreferenceForUser(userId, opts.modelId)
  if (!modelId) {
    onEvent({ type: 'error', message: NO_LLM_PROVIDER_ERROR })
    return { answer: '', iterations: 0, toolCalls: 0, tokensUsed: 0 }
  }

  onEvent({ type: 'status', status: 'preparing' })

  const resolvedModel = await resolveModel(userId, modelId)
  const useCloudRelay = resolvedModel?.adapter === 'cloud-relay'

  // Local allowance applies only when we call providers directly — cloud relay
  // bills the linked Apical account on api.apic.al.
  if (!useCloudRelay) {
    const allowance = await checkAllowance(userId)
    if (!allowance.allowed) {
      onEvent({
        type: 'error',
        message: allowance.overrunEnabled
          ? 'You have exceeded your token allowance. Add credits or enable overrun billing to continue.'
          : 'You have exceeded your token allowance for this period.',
      })
      return { answer: '', iterations: 0, toolCalls: 0, tokensUsed: 0 }
    }
  }

  const ctx: ToolContext = {
    userId,
    agentId: agentId ?? null,
    allowCli,
    maxFetchBytes: 50_000,
    findings: [],
    executionTrace: [],
    usedCredentialIds: [],
    producedAssets: [],
    userGoal: goal,
  }

  // Merge substantive steps from recent chat turns so a freeze in a follow-up
  // turn can still capture work done in the previous turn.
  if (agentId) {
    try {
      const prior = await loadPriorEngineTrace(agentId)
      if (prior.length > 0) {
        ctx.executionTrace = prior
      }
    } catch {
      // non-fatal
    }
  }

  // If we're acting AS a specific agent, load its identity + the workflow it
  // owns, so it can follow + evolve its own process.
  let ownWorkflowBlock = ''
  let agentHasSavedWorkflow = false
  if (agentId) {
    try {
      const row = await db.workflow.findFirst({
        where: { id: agentId, OR: [{ userId }, { userId: null }] },
        select: {
          name: true,
          title: true,
          description: true,
          stepsJson: true,
          schedule: true,
          trigger: true,
        },
      })
      if (row) {
        ctx.agentName = row.name
        ctx.agentTitle = row.title
        let wf: WorkflowJSON = { version: 1, steps: [] }
        try {
          wf = parseWorkflowJSON(row.stepsJson)
        } catch {
          wf = { version: 1, steps: [] }
        }
        ctx.currentWorkflow = wf
        agentHasSavedWorkflow =
          wf.steps.length > 0 && savedWorkflowHasExecutableSteps(JSON.stringify(wf))
        const stepsJson = JSON.stringify(wf, null, 2)

        let recentRunsBlock = ''
        try {
          const recentRuns = await db.run.findMany({
            where: { workflowId: agentId },
            orderBy: { startedAt: 'desc' },
            take: 5,
            select: { id: true, status: true, startedAt: true, itemsProcessed: true, flaggedCount: true },
          })
          if (recentRuns.length > 0) {
            recentRunsBlock =
              `Recent automated runs:\n` +
              recentRuns
                .map(
                  (r) =>
                    `  - ${r.startedAt.toISOString().slice(0, 16)} · ${r.status} · ${r.itemsProcessed} items${r.flaggedCount ? ` · ${r.flaggedCount} flagged` : ''}`,
                )
                .join('\n') +
              `\nCall workflow_monitor(workflowId="${agentId}") to inspect run results and failures, then workflow_update to fix broken automation nodes.\n\n`
          }
        } catch {
          // non-fatal
        }

        if (agentHasSavedWorkflow) {
          ownWorkflowBlock =
            `YOU ARE THIS AGENT: "${row.name}"${row.title ? ` (${row.title})` : ''}.\n` +
            `What you do: ${row.description}\n` +
            (row.schedule ? `Schedule: ${row.schedule} (${row.trigger})\n` : '') +
            `YOUR SAVED AUTOMATION (Phase 3 complete — you own this):\n` +
            `${stepsJson}\n\n` +
            `PHASE 4 — OVERSEE: The runtime executes this automation without you. Your job now is to monitor runs (workflow_monitor) and update nodes when they fail or requirements change (workflow_update / workflow_improve). Do NOT re-explore on every repeat unless a run failed or the user asked for changes.\n` +
            recentRunsBlock
        } else if (wf.steps.length > 0) {
          ownWorkflowBlock =
            `YOU ARE THIS AGENT: "${row.name}"${row.title ? ` (${row.title})` : ''}.\n` +
            `What you do: ${row.description}\n` +
            `YOUR AUTOMATION: INVALID — saved steps lack executable parameters. Treat as empty.\n\n` +
            `Go back to Phase 1–2: accomplish the job with real tool calls (full arguments), learn what worked, then Phase 3: workflow_freeze to design a proper automation.\n` +
            recentRunsBlock
        } else {
          ownWorkflowBlock =
            `YOU ARE THIS AGENT: "${row.name}"${row.title ? ` (${row.title})` : ''}.\n` +
            `What you do: ${row.description}\n` +
            `YOUR AUTOMATION: not designed yet.\n\n` +
            `You are a general intelligent assistant with full user context — answer any question naturally. ` +
            `For automatable jobs: Phase 1 accomplish with tools → Phase 2 learn → Phase 3 workflow_freeze → Phase 4 oversee.\n` +
            recentRunsBlock
        }
        if ((ctx.executionTrace?.length ?? 0) > 0) {
          ownWorkflowBlock +=
            `Prior substantive tool steps from recent turns are loaded into your trace (${ctx.executionTrace!.length} steps) — you can freeze them if this turn is only saving the workflow.\n\n`
        }
      }
    } catch {
      // non-fatal — proceed without the workflow block
    }
  }

  const attachmentBlock =
    attachments && attachments.length > 0
      ? `Attached files/folders:\n${attachments
          .map((a) => {
            const loc = a.localPath ? ` path=${a.localPath}` : ` url=${a.url}`
            return `- ${a.name} (${a.kind}, ${a.mimeType})${loc}`
          })
          .join('\n')}\n\n`
      : ''

  const scriptBlock = script?.code
    ? `User provided script (${script.language}) to run if relevant:\n\`\`\`${script.language}\n${script.code}\n\`\`\`\n\n`
    : ''

  const platform: ClientPlatform = clientPlatformFromRequest(isDesktop)
  const toolCatalog = toolCatalogForLLM(allowCli)
  const runtimeBlock = runtimeContextForLLM({ platform, allowCli })
  const systemPrompt = SYSTEM_PROMPT.replace('{{TOOLS}}', toolCatalog).replace(
    '{{RUNTIME}}',
    runtimeBlock,
  )

  const historyBlock =
    history && history.length > 0
      ? `Conversation so far:\n${history
          .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
          .join('\n\n')}\n\n`
      : ''

  let userContextBlock = ''
  try {
    userContextBlock = await loadUserContextBlock(userId)
  } catch {
    // non-fatal
  }

  // The conversation history (system + user goal + each thought/action/observation).
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `${userContextBlock}${ownWorkflowBlock}${historyBlock}${attachmentBlock}${scriptBlock}Goal: ${goal}${context ? `\n\nAdditional context:\n${context}` : ''}\n\nBegin. Respond with JSON only.`,
    },
  ]

  let iterations = 0
  let toolCalls = 0
  let tokensUsed = 0
  let finalAnswer = ''
  let lastError: string | null = null
  let workflowSaveNudges = 0
  let failureHonestyNudges = 0

  /** Agent completed real work but hasn't persisted its owned workflow yet. */
  const needsWorkflowSave = (): boolean => {
    if (ctx.workflowSavedToAgentId || ctx.createdAgentId) return false
    if (countSubstantiveTraceSteps(ctx.executionTrace) < 2) return false
    if (agentId && !agentHasSavedWorkflow) return true
    return false
  }

  /** Agent has a workflow but did substantive work without updating — suggest once. */
  const shouldSuggestWorkflowUpdate = (): boolean => {
    if (!agentId || !agentHasSavedWorkflow) return false
    if (ctx.workflowSavedToAgentId) return false
    return countSubstantiveTraceSteps(ctx.executionTrace) >= 2
  }

  const autoSaveOwnedWorkflow = async (reason: string): Promise<boolean> => {
    if (!agentId || ctx.workflowSavedToAgentId) return false
    const saved = await persistAgentWorkflowFromTrace(ctx, {
      description: ctx.agentName ? `${ctx.agentName} workflow` : undefined,
    })
    if (!saved.ok) return false
    onEvent({
      type: 'observation',
      tool: 'workflow_freeze',
      ok: true,
      output: {
        agentId,
        stepCount: saved.stepCount,
        autoSaved: true,
        reason,
      },
      display: {
        title: 'Saved your workflow',
        summary: `${saved.stepCount} steps · auto-saved from proven run`,
        kind: 'workflow',
      },
    })
    return true
  }

  onEvent({ type: 'status', status: 'thinking' })

  while (iterations < maxIterations) {
    iterations += 1

    // Budget nudge: when we're running low on iterations, tell the LLM to
    // wrap up with a final answer or call workflow_freeze.
    const remaining = maxIterations - iterations
    if (remaining === 8) {
      messages.push({
        role: 'user',
        content: 'NOTE: You have 8 iterations left. If this is a recurring job, wrap up the lifecycle: workflow_freeze (Phase 3 design) → schedule_agent if recurring → emit final with what you accomplished + what automation you saved + that you will oversee runs. Pure questions: just emit final.',
      })
    }

    // --- Call the LLM, streaming tokens so the chain-of-thought and the final
    // answer surface live. We still accumulate the full JSON and parse it at
    // the end for the actual decision (which tool to run / final answer).
    // chatStream records usage internally (and bills cloud-relay remotely). ---
    let raw = ''
    let usage: { promptTokens: number; completionTokens: number; totalTokens: number } = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    let emittedThought = 0
    let emittedAnswer = 0
    try {
      for await (const ev of chatStream({
        modelId,
        userId,
        source: meterSource,
        messages,
        temperature: 0.4,
        maxTokens: 1200,
        // The ReAct loop parses a JSON decision and streams the "thought" field
        // as visible chain-of-thought, so we don't want Anthropic's hidden
        // extended thinking (it adds latency + forbids our temperature).
        thinking: false,
      })) {
        if (ev.type === 'delta' && ev.content) {
          raw += ev.content
          // Stream the in-progress chain-of-thought as it's written.
          const thoughtSoFar = extractJsonStringValue(raw, 'thought')
          if (thoughtSoFar.length > emittedThought) {
            onEvent({ type: 'thought_delta', text: thoughtSoFar.slice(emittedThought) })
            emittedThought = thoughtSoFar.length
          }
          // Stream the in-progress final answer (only present on a final turn).
          const answerSoFar = extractJsonStringValue(raw, 'answer')
          if (answerSoFar.length > emittedAnswer) {
            onEvent({ type: 'answer_delta', text: answerSoFar.slice(emittedAnswer) })
            emittedAnswer = answerSoFar.length
          }
        } else if (ev.type === 'done' && ev.usage) {
          usage = ev.usage
        }
      }
      tokensUsed += usage.totalTokens
    } catch (e) {
      lastError = (e as Error).message
      onEvent({ type: 'error', message: `LLM call failed: ${lastError}` })
      break
    }

    // --- Parse the LLM's JSON response. ---
    const parsed = parseAgentResponse(raw)
    if (!parsed) {
      // The LLM didn't return valid JSON. Nudge it.
      messages.push({ role: 'assistant', content: raw })
      messages.push({
        role: 'user',
        content: 'Your response was not valid JSON. Respond with ONLY a JSON object in the shape {"thought":"...","action":{"tool":"...","input":{...}}} or {"thought":"...","final":{"answer":"..."}}. No prose, no code fences.',
      })
      continue
    }

    // Surface the thought (chain-of-thought).
    if (parsed.thought) {
      onEvent({ type: 'thought', text: parsed.thought })
      messages.push({ role: 'assistant', content: raw })
    }

    // --- Final answer? ---
    if (parsed.final) {
      if (needsWorkflowSave() && workflowSaveNudges < 2) {
        workflowSaveNudges += 1
        messages.push({ role: 'assistant', content: raw })
        messages.push({
          role: 'user',
          content:
            'BLOCKED — you accomplished the task (Phase 1) but have NOT designed the automation yet (Phase 3). ' +
            'Call workflow_freeze NOW (name + description) to save the n8n-style production workflow from what you learned. ' +
            'After freezing, emit your final answer and mention you will oversee future runs (Phase 4).',
        })
        onEvent({ type: 'status', status: 'thinking' })
        continue
      }

      if (needsWorkflowSave()) {
        if (!runHasFailures(ctx)) {
          await autoSaveOwnedWorkflow('Agent finished without calling workflow_freeze')
        }
      } else if (shouldSuggestWorkflowUpdate() && workflowSaveNudges === 0) {
        workflowSaveNudges += 1
        messages.push({ role: 'assistant', content: raw })
        messages.push({
          role: 'user',
          content:
            'Before you finish: you have a saved workflow but this run used a different approach. ' +
            'If the new process is better, call workflow_update with the complete improved steps. ' +
            'If you followed your workflow as-is, emit your final answer now.',
        })
        onEvent({ type: 'status', status: 'thinking' })
        continue
      }

      const failures = collectRunFailures(ctx)
      if (failures.length > 0 && failureHonestyNudges < 2) {
        failureHonestyNudges += 1
        messages.push({ role: 'assistant', content: raw })
        messages.push({
          role: 'user',
          content:
            `BLOCKED — ${failures.length} tool step(s) FAILED this run:\n${failures.map((f) => `- ${f}`).join('\n')}\n\n` +
            'Do NOT claim success or say the workflow/automation was saved if workflow_freeze or schedule_agent failed. ' +
            'Either retry until the failed steps succeed, OR emit a final answer that honestly states what failed, what (if anything) worked, and what needs user review.',
        })
        onEvent({ type: 'status', status: 'thinking' })
        continue
      }

      finalAnswer = prefixFailedRunAnswer(
        parsed.final.answer?.trim() ||
          parsed.thought?.trim() ||
          'I finished, but did not return a written summary.',
        failures,
      )
      onEvent({ type: 'status', status: 'done' })
      onEvent({
        type: 'final',
        answer: finalAnswer,
        proposedWorkflow: ctx.proposedWorkflow,
        findings: ctx.findings,
        attachments: ctx.producedAssets,
        workflowSavedToAgentId: failures.length > 0 ? undefined : ctx.workflowSavedToAgentId,
        credentialRequest: ctx.credentialRequest,
        createdAgentId: ctx.createdAgentId,
        createdAgentName: ctx.createdAgentName,
        runFailures: failures.length > 0 ? failures : undefined,
        plan: ctx.plan,
      })
      return {
        answer: finalAnswer,
        proposedWorkflow: ctx.proposedWorkflow,
        findings: ctx.findings,
        attachments: ctx.producedAssets,
        workflowSavedToAgentId: failures.length > 0 ? undefined : ctx.workflowSavedToAgentId,
        credentialRequest: ctx.credentialRequest,
        createdAgentId: ctx.createdAgentId,
        createdAgentName: ctx.createdAgentName,
        plan: ctx.plan,
        iterations,
        toolCalls,
        tokensUsed,
      }
    }

    // --- Tool call? ---
    if (parsed.action) {
      const { tool, input } = parsed.action as ToolCall

      // Special: update_plan — live checklist, rendered as a dedicated card
      // (not a generic timeline step). Set ctx.plan + emit a `plan` event.
      if (tool === 'update_plan') {
        const planDef = getAgentTool('update_plan')
        const planResult = planDef ? await planDef.run(input, ctx) : { ok: false, output: null, error: 'update_plan unavailable' }
        toolCalls += 1
        if (!parsed.thought) messages.push({ role: 'assistant', content: raw })
        if (planResult.ok && ctx.plan) {
          onEvent({ type: 'plan', items: ctx.plan })
          messages.push({
            role: 'user',
            content: `Observation (update_plan): ${JSON.stringify(planResult.output)}. Checklist saved + shown to the user. Continue working through the steps; call update_plan again to mark items in_progress/done.`,
          })
        } else {
          messages.push({
            role: 'user',
            content: `Observation (update_plan): Error — ${planResult.error}. Provide a non-empty items array of { id, label, status }.`,
          })
        }
        onEvent({ type: 'status', status: 'thinking' })
        continue
      }

      // Special: ask_clarification / request_review — both END the turn with a
      // multiple-choice card the user clicks. The selection arrives as the next
      // message. ask_clarification = disambiguate; request_review = approval
      // gate before a high-stakes / irreversible action.
      if (tool === 'ask_clarification' || tool === 'request_review') {
        const clarifyDef = getAgentTool(tool)
        const clarifyResult = clarifyDef ? await clarifyDef.run(input, ctx) : { ok: false, output: null, error: `${tool} unavailable` }
        if (!clarifyResult.ok || !ctx.clarification) {
          if (!parsed.thought) messages.push({ role: 'assistant', content: raw })
          messages.push({
            role: 'user',
            content: `Observation (${tool}): Error — ${clarifyResult.error}. Provide a ${tool === 'request_review' ? 'summary and at least 2 options (e.g. approve / cancel)' : 'question and at least 2 options'}.`,
          })
          onEvent({ type: 'status', status: 'thinking' })
          continue
        }
        toolCalls += 1
        const question = ctx.clarification
        const isReview = question.kind === 'review'
        const clarifyAnswer =
          parsed.thought && parsed.thought.trim().length > 0 && parsed.thought.trim().length < 320
            ? parsed.thought.trim()
            : isReview
              ? `I need your approval before continuing: ${question.question}`
              : `Before I continue, I need a bit more detail: ${question.question}`
        finalAnswer = clarifyAnswer
        onEvent({ type: 'clarification', question })
        onEvent({ type: 'status', status: 'done' })
        onEvent({
          type: 'final',
          answer: clarifyAnswer,
          findings: ctx.findings,
          attachments: ctx.producedAssets,
          plan: ctx.plan,
          clarification: question,
        })
        return {
          answer: clarifyAnswer,
          findings: ctx.findings,
          attachments: ctx.producedAssets,
          plan: ctx.plan,
          clarification: question,
          iterations,
          toolCalls,
          tokensUsed,
        }
      }

      const def = getAgentTool(tool)
      if (!def) {
        onEvent({ type: 'observation', tool, ok: false, output: null })
        messages.push({
          role: 'user',
          content: `Observation: Error — unknown tool "${tool}". Available tools: ${AGENT_TOOLS.map((t) => t.name).join(', ')}`,
        })
        continue
      }

      // Pre-call validation: check required params are present. This catches
      // the common failure where the LLM sends an empty input object.
      const missing: string[] = []
      for (const [k, schema] of Object.entries(def.inputSchema)) {
        if (schema.required && (input[k] === undefined || input[k] === null || input[k] === '')) {
          missing.push(k)
        }
      }
      if (missing.length > 0) {
        onEvent({ type: 'status', status: 'acting' })
        onEvent({ type: 'tool_call', tool, input })
        onEvent({
          type: 'observation',
          tool,
          ok: false,
          output: null,
          display: { title: `${tool} (missing params)`, summary: missing.join(', '), kind: 'info' },
        })
        messages.push({
          role: 'user',
          content: `Observation (${tool}): Error — missing required params: ${missing.join(', ')}. The input you sent was ${JSON.stringify(input)}. You MUST include all required params. Param schema: ${JSON.stringify(def.inputSchema)}`,
        })
        continue
      }

      // Block workflow_freeze when the trace has no real work to save.
      if (tool === 'workflow_freeze') {
        const freezeCheck = validateWorkflowFreezeTrace(ctx.executionTrace)
        if (!freezeCheck.ok) {
          onEvent({ type: 'status', status: 'acting' })
          onEvent({ type: 'tool_call', tool, input })
          onEvent({
            type: 'observation',
            tool,
            ok: false,
            output: null,
            error: freezeCheck.error,
            display: { title: 'Cannot freeze yet', summary: 'Do the actual task with tools first', kind: 'info' },
          })
          messages.push({
            role: 'user',
            content: `Observation (${tool}): Error — ${freezeCheck.error}`,
          })
          onEvent({ type: 'status', status: 'thinking' })
          continue
        }
      }

      onEvent({ type: 'status', status: 'acting' })
      onEvent({ type: 'tool_call', tool, input })
      toolCalls += 1

      // Track substantive steps in the execution trace (meta tools are excluded).
      const traceStepId = `t${(ctx.executionTrace?.length ?? 0) + 1}`
      const traceStart = Date.now()
      const isMetaTool = WORKFLOW_META_TOOLS.has(tool)
      if (!isMetaTool) {
        const traceKind: 'tool' | 'reason' | 'gate' =
          tool === 'code_eval' ? 'reason' : 'tool'
        const safeInput = sanitizeTraceInput(input)
        ctx.executionTrace?.push({
          stepId: traceStepId,
          kind: traceKind,
          label: traceStepLabel(tool, safeInput),
          tool: tool === 'http_request' ? 'http' : tool === 'mcp_call_tool' ? 'mcp' : tool,
          input: safeInput,
          status: 'running',
        })
      }

      // Track credential usage (for the freeze step's credentialIds).
      const credId = (input.credentialId as string) || (input.bearerToken as string)
      if (credId && ctx.usedCredentialIds && !ctx.usedCredentialIds.includes(credId)) {
        ctx.usedCredentialIds.push(credId)
      }

      onEvent({ type: 'status', status: 'observing' })
      let result: ToolResult
      const TOOL_RUN_TIMEOUT_MS = 45_000
      try {
        result = await Promise.race([
          def.run(input, ctx),
          new Promise<ToolResult>((resolve) => {
            setTimeout(
              () =>
                resolve({
                  ok: false,
                  output: null,
                  error: `Tool "${tool}" timed out after ${TOOL_RUN_TIMEOUT_MS / 1000}s`,
                }),
              TOOL_RUN_TIMEOUT_MS,
            )
          }),
        ])
      } catch (e) {
        result = { ok: false, output: null, error: (e as Error).message }
      }

      if (!result.ok && WORKFLOW_META_TOOLS.has(tool)) {
        ctx.metaToolFailures = ctx.metaToolFailures ?? []
        ctx.metaToolFailures.push({ tool, error: result.error ?? 'failed' })
      }

      // Update the trace step with the result (if we tracked one).
      const traceStep = !isMetaTool
        ? ctx.executionTrace?.find((s) => s.stepId === traceStepId)
        : undefined
      if (traceStep) {
        traceStep.status = result.ok ? 'done' : 'error'
        traceStep.durationMs = Date.now() - traceStart
        traceStep.result = result.ok
          ? (typeof result.output === 'string' ? result.output.slice(0, 200) : JSON.stringify(result.output).slice(0, 200))
          : undefined
        traceStep.error = result.error
      }

      onEvent({
        type: 'observation',
        tool,
        ok: result.ok,
        output: result.output,
        error: result.error,
        display: result.display,
      })

      // Feed the observation back to the LLM (as a user message so the
      // assistant's next turn can build on it). On failure, include the
      // error + the required params so the LLM can self-correct.
      const obsText = result.ok
        ? JSON.stringify(result.output).slice(0, 12_000)
        : `Error: ${result.error}. Required params for ${tool}: ${JSON.stringify(def.inputSchema)}`
      messages.push({
        role: 'user',
        content: `Observation (${tool}): ${obsText}${
          tool === 'workflow_freeze' && result.ok
            ? ' IMPORTANT: Your final answer must describe ONLY the savedSteps in this output. Do not invent steps that are not in savedSteps.'
            : !result.ok
              ? ' IMPORTANT: This step FAILED. Do not claim success or say the workflow was saved until this succeeds.'
              : ''
        }`,
      })
      onEvent({ type: 'status', status: 'thinking' })
      continue
    }

    // Neither final nor action — nudge.
    messages.push({
      role: 'user',
      content: 'Respond with either an action ({"thought":...,"action":{"tool":...,"input":...}}) or a final answer ({"thought":...,"final":{"answer":...}}).',
    })
  }

  // Budget exhausted without a final answer.
  if (!finalAnswer) {
    if (needsWorkflowSave() && !runHasFailures(ctx)) {
      await autoSaveOwnedWorkflow('Iteration budget reached — auto-saving proven workflow')
    }
    const failures = collectRunFailures(ctx)
    finalAnswer =
      `I worked on this for ${iterations} iterations${toolCalls ? ` and made ${toolCalls} tool calls` : ''}, but hit the iteration budget before producing a final answer. ` +
      (ctx.proposedWorkflow
        ? 'I did draft a workflow proposal — review it below.'
        : lastError
          ? `Last error: ${lastError}`
          : 'Try rephrasing the goal or increasing the iteration budget.')
    if (failures.length > 0) {
      finalAnswer = prefixFailedRunAnswer(finalAnswer, failures)
    }
    onEvent({
      type: 'final',
      answer: finalAnswer,
      proposedWorkflow: ctx.proposedWorkflow,
      findings: ctx.findings,
      workflowSavedToAgentId: failures.length > 0 ? undefined : ctx.workflowSavedToAgentId,
      credentialRequest: ctx.credentialRequest,
      createdAgentId: ctx.createdAgentId,
      createdAgentName: ctx.createdAgentName,
      runFailures: failures.length > 0 ? failures : undefined,
      plan: ctx.plan,
    })
  }

  return {
    answer: finalAnswer,
    proposedWorkflow: ctx.proposedWorkflow,
    findings: ctx.findings,
    workflowSavedToAgentId: ctx.workflowSavedToAgentId,
    credentialRequest: ctx.credentialRequest,
    createdAgentId: ctx.createdAgentId,
    createdAgentName: ctx.createdAgentName,
    plan: ctx.plan,
    iterations,
    toolCalls,
    tokensUsed,
  }
}

// ---------------- Response parsing ----------------

interface ParsedAgentResponse {
  thought?: string
  action?: ToolCall
  final?: { answer?: string }
}

/**
 * Pull the (possibly in-progress) string value for a JSON key out of a partial
 * JSON string being streamed from the LLM. Returns the decoded string so far
 * (handling \\" \\n \\uXXXX etc.); '' if the key/value hasn't started yet.
 * Used to surface the live "thought" + final "answer" while the JSON streams.
 */
function extractJsonStringValue(raw: string, key: string): string {
  const marker = `"${key}"`
  let i = raw.indexOf(marker)
  if (i < 0) return ''
  i += marker.length
  while (i < raw.length && /\s/.test(raw[i])) i++
  if (raw[i] !== ':') return ''
  i++
  while (i < raw.length && /\s/.test(raw[i])) i++
  if (raw[i] !== '"') return ''
  i++
  let out = ''
  while (i < raw.length) {
    const c = raw[i]
    if (c === '\\') {
      const n = raw[i + 1]
      if (n === undefined) break // incomplete escape at the stream boundary
      switch (n) {
        case 'n': out += '\n'; break
        case 't': out += '\t'; break
        case 'r': out += '\r'; break
        case '"': out += '"'; break
        case '\\': out += '\\'; break
        case '/': out += '/'; break
        case 'b': out += '\b'; break
        case 'f': out += '\f'; break
        case 'u': {
          const hex = raw.slice(i + 2, i + 6)
          if (hex.length < 4) return out // incomplete unicode escape
          out += String.fromCharCode(parseInt(hex, 16) || 0)
          i += 4
          break
        }
        default: out += n
      }
      i += 2
      continue
    }
    if (c === '"') break // closing quote — value complete
    out += c
    i++
  }
  return out
}

function parseAgentResponse(raw: string): ParsedAgentResponse | null {
  if (!raw) return null
  // The LLM may wrap JSON in code fences despite instructions. Strip them.
  let s = raw.trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  // If there's prose before the JSON, try to find the first { ... } block.
  if (!s.startsWith('{')) {
    const start = s.indexOf('{')
    const end = s.lastIndexOf('}')
    if (start >= 0 && end > start) s = s.slice(start, end + 1)
  }
  try {
    const obj = JSON.parse(s) as ParsedAgentResponse
    if (typeof obj !== 'object' || obj === null) return null
    return obj
  } catch {
    return null
  }
}

// Re-export for callers that want to stream the thought.
export { chatStream }
