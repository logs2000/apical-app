import Link from 'next/link'
import {
  BookOpen,
  Rocket,
  ShieldCheck,
  Bot,
  Workflow,
  Plug,
  Code2,
  ArrowRight,
  Terminal,
  Copy,
} from 'lucide-react'

import { ApicalMark } from '@/components/apical/logo'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

// ─── Doc metadata ────────────────────────────────────────────────────────────

const SECTIONS = [
  {
    id: 'quickstart',
    title: 'Quickstart',
    icon: Rocket,
    description: 'Get from zero to your first Apical agent in under five minutes.',
    body: (
      <div className="space-y-4">
        <p>
          Apical is an agent platform that turns natural-language requests into multi-step
          workflows. You describe the outcome; Apical plans, executes, and reports back.
        </p>
        <ol className="ml-4 list-decimal space-y-2 text-sm text-muted-foreground">
          <li>Create an account — it&apos;s free, no credit card required.</li>
          <li>Open the web app from the landing page.</li>
          <li>Tell Apical what you want done in plain English.</li>
          <li>Approve the proposed workflow and watch it run.</li>
        </ol>
        <CodeBlock
          label="Install the CLI (optional)"
          lines={['curl -fsSL https://apic.al/install.sh | sh', 'apical login']}
        />
      </div>
    ),
  },
  {
    id: 'authentication',
    title: 'Authentication',
    icon: ShieldCheck,
    description: 'Sign in, sessions, API keys, and personal access tokens.',
    body: (
      <div className="space-y-4">
        <p>
          Apical uses NextAuth with a JWT session strategy. You can sign in with email +
          password or Google OAuth. For programmatic access, generate a Personal Access
          Token (PAT) from <span className="font-mono text-xs">Settings → API Tokens</span>.
        </p>
        <CodeBlock
          label="Authenticate a REST request"
          lines={[
            'curl https://api.apic.al/api/agents \\',
            '  -H "Authorization: Bearer ap_pat_xxxxxxxxxxxxxxxxxxxxxxxx"',
          ]}
        />
        <p className="text-sm text-muted-foreground">
          PATs are SHA-256 hashed at rest. The raw token is shown once at creation — store
          it securely. Revoke at any time from the dashboard.
        </p>
      </div>
    ),
  },
  {
    id: 'agents',
    title: 'Agents',
    icon: Bot,
    description: 'Build, deploy, and chat with AI agents that do real work.',
    body: (
      <div className="space-y-4">
        <p>
          An Agent is a configured LLM with a system prompt, a model, and a set of allowed
          tools. Agents run on either the hosted runtime or your local desktop runtime.
        </p>
        <ul className="ml-4 list-disc space-y-1 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">Hosted</span> — runs on Apical
            servers; available from anywhere.
          </li>
          <li>
            <span className="font-medium text-foreground">Local</span> — runs on your
            machine via the desktop bridge; has filesystem, CLI, and network access.
          </li>
        </ul>
        <CodeBlock
          label="Register an agent"
          lines={[
            'POST /api/agents/register',
            '{',
            '  "name": "Research Scout",',
            '  "model": "anthropic:claude-3-5-sonnet",',
            '  "systemPrompt": "You are a research analyst..."',
            '}',
          ]}
        />
      </div>
    ),
  },
  {
    id: 'workflows',
    title: 'Workflows',
    icon: Workflow,
    description: 'Multi-step plans that orchestrate tools, data, and LLM calls.',
    body: (
      <div className="space-y-4">
        <p>
          A Workflow is a sequence of steps produced by an agent&apos;s planner. Each step
          is typed (LLM call, MCP tool call, REST request, condition) and runs in order.
          Workflows can be triggered manually, on a schedule, or from an agent chat.
        </p>
        <CodeBlock
          label="Trigger a workflow run"
          lines={['POST /api/workflows/{id}/run', '{}']}
        />
        <p className="text-sm text-muted-foreground">
          Runs stream progress over a relay so the UI updates in real time. Every run is
          auditable and replayable.
        </p>
      </div>
    ),
  },
  {
    id: 'mcp',
    title: 'MCP',
    icon: Plug,
    description: 'Connect any Model Context Protocol server as a tool source.',
    body: (
      <div className="space-y-4">
        <p>
          The Model Context Protocol (MCP) is an open standard for connecting AI models to
          external tools and data sources. Apical is an MCP client — point it at any MCP
          server and the tools become available to your agents.
        </p>
        <CodeBlock
          label="Connect an MCP server"
          lines={[
            'POST /api/mcp/connect',
            '{',
            '  "name": "github",',
            '  "transport": "stdio",',
            '  "command": "npx",',
            '  "args": ["-y", "@modelcontextprotocol/server-github"]',
            '}',
          ]}
        />
        <p className="text-sm text-muted-foreground">
          Use the <span className="font-mono text-xs">apical-mcp</span> mini-service to
          expose your Apical agents as an MCP server to other AI clients.
        </p>
      </div>
    ),
  },
  {
    id: 'api-reference',
    title: 'API Reference',
    icon: Code2,
    description: 'REST endpoints for everything you can do in the UI.',
    body: (
      <div className="space-y-4">
        <p>
          Every Apical feature is exposed via a REST API. All endpoints are prefixed with{' '}
          <span className="font-mono text-xs">/api</span> and accept JSON. Authenticate
          with a Bearer PAT or a session cookie.
        </p>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Method</th>
                <th className="px-3 py-2 font-medium">Endpoint</th>
                <th className="px-3 py-2 font-medium">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                ['GET', '/api/agents', 'List your agents'],
                ['POST', '/api/agents/register', 'Register a new agent'],
                ['POST', '/api/agents/{id}/chat', 'Send a chat message'],
                ['GET', '/api/workflows', 'List workflows'],
                ['POST', '/api/workflows/{id}/run', 'Trigger a workflow run'],
                ['GET', '/api/mcp', 'List connected MCP servers'],
                ['POST', '/api/mcp/{id}/call', 'Invoke a tool on an MCP server'],
                ['GET', '/api/dev/keys', 'List developer API keys'],
                ['POST', '/api/dev/run', 'Trigger a run via API key'],
              ].map(([method, path, desc]) => (
                <tr key={path} className="hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Badge
                      variant={
                        method === 'GET'
                          ? 'secondary'
                          : method === 'POST'
                            ? 'default'
                            : 'outline'
                      }
                      className="font-mono text-[10px]"
                    >
                      {method}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{path}</td>
                  <td className="px-3 py-2 text-muted-foreground">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    ),
  },
] as const

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <ApicalMark className="h-6 w-6" />
            <span className="text-sm font-semibold tracking-tight">
              Apical<span className="text-brand">.</span>
            </span>
            <span className="ml-2 text-xs text-muted-foreground">Docs</span>
          </Link>
          <nav className="flex items-center gap-4 text-xs text-muted-foreground">
            <Link href="/" className="hover:text-foreground">
              Home
            </Link>
            <Link href="/developer" className="hover:text-foreground">
              Developer
            </Link>
            <Link
              href="/login"
              className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground hover:bg-primary/90"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-[200px_1fr]">
        {/* Sidebar */}
        <aside className="md:sticky md:top-20 md:self-start">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5" />
            Documentation
          </div>
          <nav className="flex flex-row flex-wrap gap-1 md:flex-col">
            {SECTIONS.map((s) => {
              const Icon = s.icon
              return (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  <Icon className="h-3.5 w-3.5 text-brand/70 group-hover:text-brand" />
                  {s.title}
                </a>
              )
            })}
          </nav>
        </aside>

        {/* Content */}
        <main className="min-w-0 space-y-12">
          <section className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight">
              Apical Documentation
            </h1>
            <p className="max-w-2xl text-muted-foreground">
              Everything you need to build, deploy, and orchestrate AI agents that actually
              do the work. Pick a section below to get started.
            </p>
          </section>

          {SECTIONS.map((s) => {
            const Icon = s.icon
            return (
              <section key={s.id} id={s.id} className="scroll-mt-20">
                <Card className="border-border/60">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-foreground">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{s.title}</CardTitle>
                        <CardDescription>{s.description}</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>{s.body}</CardContent>
                </Card>
              </section>
            )
          })}

          {/* CTA */}
          <section className="rounded-xl border border-border bg-muted p-6 text-center">
            <h2 className="text-lg font-semibold">Ready to build?</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Create a free account and ship your first agent in minutes.
            </p>
            <div className="mt-4 flex items-center justify-center gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Get started free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/developer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Open developer console
              </Link>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

// ─── Code block helper (server component — no client state) ──────────────────

function CodeBlock({ label, lines }: { label: string; lines: string[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
        <Terminal className="h-3 w-3" />
        {label}
        <Copy className="ml-auto h-3 w-3 opacity-50" />
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 text-xs leading-relaxed">
        <code className="font-mono">
          {lines.map((l, i) => (
            <div key={i} className="whitespace-pre">
              {l}
            </div>
          ))}
        </code>
      </pre>
    </div>
  )
}
