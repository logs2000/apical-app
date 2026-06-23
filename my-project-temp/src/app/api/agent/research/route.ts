import { NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { integrationFromRow } from '@/lib/apical-server'
import type { ResearchPlan, WorkflowJSON } from '@/lib/types'

// POST /api/agent/research — general-purpose deep reasoning.
//
// The agent considers ALL available tools (web search, filesystem, CLI, network,
// MCP servers, APIs, connected integrations) and reasons about the best strategy
// to accomplish the user's goal. It then proposes a complete workflow.
//
// This is NOT a hardcoded web-crawler. The agent decides what tools to use based
// on the task. For "find potential clients" it might search the web + crawl sites.
// For "monitor network devices" it might use CLI tools (nmap, arp) + filesystem.
// For "sort scanned documents" it might use OCR + filesystem + business rules.
// For "track competitor pricing" it might crawl competitor sites + diff.

interface ResearchBody {
  goal: string
  context?: string
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ResearchBody
    const goal = (body.goal || '').trim()
    if (!goal) {
      return NextResponse.json({ error: 'goal is required' }, { status: 400 })
    }

    const zai = await ZAI.create()

    // ---- Build the agent's tool inventory ----
    // The agent needs to know what tools it HAS so it can reason about which to use.
    const integrations = await db.integration.findMany({ where: { status: 'connected' } })
    const toolInventory = integrations.flatMap((i) => {
      const tools = JSON.parse(i.tools) as Array<{ id: string; name: string; description: string }>
      return tools.map((t) => `- ${t.id} (${i.name}): ${t.description}`)
    }).join('\n')

    // ---- Phase 1: Web search (if the task might need external data) ----
    // The agent decides whether to search the web based on the goal.
    // We always do a search — if the task is purely local (filesystem/CLI),
    // the search results just won't be relevant and the agent will ignore them.
    const searchResults = await zai.functions.invoke('web_search', {
      query: goal,
      num: 8,
    })

    const searchContext = (searchResults as Array<{ url: string; name: string; snippet: string; host_name: string }>)
      .slice(0, 6)
      .map((r, i) => `${i + 1}. ${r.name} (${r.host_name})\n   ${r.url}\n   ${r.snippet}`)
      .join('\n\n')

    // ---- Phase 2: LLM reasons about the task + available tools + findings ----
    const systemPrompt = `You are Apical's autonomous reasoning engine. The user asked you to accomplish this goal:

"${goal}"

${body.context ? `Additional context: ${body.context}\n` : ''}
AVAILABLE TOOLS (the agent can use any of these in its workflow):
${toolInventory || '- files.list/read/write/move (local filesystem)\n- cli.run (execute local commands)\n- http.request (make HTTP calls to any URL)\n- ocr.extract (extract text from documents)\n- scanner.* (scanner hardware)\n- slack.notify (send Slack messages)\n- gmail.* (email operations)\n- quickbooks.* (accounting)\n- stripe.* (payments)'}

WEB SEARCH RESULTS (may or may not be relevant — use your judgment):
${searchContext}

Now reason about the BEST strategy to accomplish this goal. Consider:
1. What data sources are relevant? (websites, APIs, local files, CLI output, network scans, email, databases)
2. What tools do you need? (from the available tools above + any http calls to discovered APIs)
3. What's the extraction strategy? (API calls, scraping, file reading, CLI commands, email parsing)
4. Rate limits or access constraints? (note them so the workflow can handle them)
5. How should the data be processed? (filtering, ranking, enrichment, deduplication)
6. What should be automated vs. what needs human review? (gates for uncertain decisions)
7. How often should this run? (consider how frequently the data changes)
8. Can parts be hardened into deterministic rules to save AI costs?

Respond with ONLY JSON (no prose, no code fences):
{
  "strategy": "3-5 sentences in plain English explaining your strategy — what data sources, what tools, what approach.",
  "findings": [
    {
      "source": "name of the data source",
      "url": "URL or path or CLI command",
      "type": "website" | "api" | "data_feed" | "directory" | "local_file" | "cli_command" | "email" | "database",
      "description": "what this source provides",
      "endpoints": [{"method": "GET", "path": "/api/...", "description": "what it returns"}],
      "rateLimit": "e.g. '100 req/min' or 'Unknown — assume 1 req/sec' or 'N/A (local)'"
    }
  ],
  "proposedWorkflow": {
    "version": 1,
    "steps": [
      // Build a workflow that implements your strategy.
      // Use 'tool' steps for mechanical work (fetch, read, write, CLI).
      // Use 'http' specs for API calls (with auth refs where needed).
      // Use 'reason' steps ONLY where genuine judgment is needed.
      // Use 'spawn' steps for parallelizable sub-tasks.
      // Use 'gate' steps before irreversible actions.
      // Include rate-limit-aware notes on steps that hit external APIs.
      // 5-10 steps total.
    ]
  },
  "scheduleRecommendation": {
    "frequency": "Daily" | "Weekly" | "Monthly" | "Hourly" | "Manual",
    "reason": "Why this frequency makes sense."
  },
  "estimatedCost": "Approx $0.XX per run (N AI calls + N API calls)",
  "needsCredentials": [
    {"service": "name", "reason": "why needed"}
  ]
}`

    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: systemPrompt },
        { role: 'user', content: `Build a plan for: ${goal}` },
      ],
      thinking: { type: 'disabled' },
    })

    const text = completion.choices[0]?.message?.content || ''
    let plan: Partial<ResearchPlan>
    try {
      const cleaned = text.replace(/```json\s*/g, '').replace(/```/g, '').trim()
      plan = JSON.parse(cleaned)
    } catch {
      plan = {
        strategy: `I analyzed the available tools and data sources for "${goal}". I'll use a combination of tool steps to gather data and reason steps to process it.`,
        findings: [],
        proposedWorkflow: { version: 1, steps: [] },
        scheduleRecommendation: { frequency: 'Manual', reason: 'Run manually until the pattern is stable.' },
        estimatedCost: '~$0.05 per run',
        needsCredentials: [],
      }
    }

    // ---- Phase 3: Try to crawl any web-based findings for API endpoints ----
    // (Only for findings that are websites — local/CLI findings don't need crawling.)
    const enrichedFindings: ResearchPlan['findings'] = []
    for (const finding of (plan.findings ?? [])) {
      const enriched = { ...finding }
      if ((finding.type === 'website' || finding.type === 'api' || finding.type === 'directory') && finding.url?.startsWith('http')) {
        try {
          const pageResp = await fetch(finding.url, {
            signal: AbortSignal.timeout(8000),
            headers: { 'User-Agent': 'Apical-Research-Bot/1.0' },
          })
          if (pageResp.ok) {
            const html = await pageResp.text()
            // Look for API endpoints.
            const apiPatterns = [/['"`](\/api\/[^'"`\s?#]+)/g, /fetch\(['"`]([^'"`]+)['"`]/g]
            const endpoints: Array<{ method: string; path: string; description: string }> = []
            for (const pattern of apiPatterns) {
              for (const m of [...html.matchAll(pattern)]) {
                if (m[1] && !endpoints.some((e) => e.path === m[1]) && endpoints.length < 5) {
                  endpoints.push({ method: 'GET', path: m[1], description: `Discovered on ${finding.source}` })
                }
              }
            }
            if (endpoints.length > 0) enriched.endpoints = endpoints
            // Rate limit headers.
            const rateLimit = pageResp.headers.get('x-ratelimit-limit')
            const retryAfter = pageResp.headers.get('retry-after')
            if (rateLimit || retryAfter) {
              enriched.rateLimit = `${rateLimit ? `${rateLimit} req` : ''}${retryAfter ? ` (retry after ${retryAfter}s)` : ''}`
            }
          }
        } catch { /* can't fetch — that's OK */ }
      }
      enrichedFindings.push(enriched)
    }

    const researchPlan: ResearchPlan = {
      goal,
      findings: enrichedFindings,
      strategy: plan.strategy ?? 'Strategy determined.',
      proposedWorkflow: (plan.proposedWorkflow ?? { version: 1, steps: [] }) as WorkflowJSON,
      scheduleRecommendation: plan.scheduleRecommendation ?? { frequency: 'Manual', reason: 'Run manually first.' },
      estimatedCost: plan.estimatedCost ?? '~$0.05 per run',
      needsCredentials: plan.needsCredentials ?? [],
    }

    return NextResponse.json(researchPlan)
  } catch (err) {
    console.error('[api/agent/research] failed:', err)
    return NextResponse.json({ error: 'Research failed: ' + (err as Error).message }, { status: 500 })
  }
}
