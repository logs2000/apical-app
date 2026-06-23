'use client'

// Apical — Desktop bridge settings panel.
//
// The desktop bridge lets hosted agents access a connected desktop's
// filesystem, CLI, network, keychain, and notification system via 9 MCP-style
// tools (`desktop.fs.*`, `desktop.cli.run`, `desktop.net.fetch`,
// `desktop.notify`, `desktop.secrets.get`).
//
// This panel is the user's control surface. It shows:
//   1. Connected desktops — list with online/offline badge + Revoke.
//   2. Add desktop — mints a `dsk_` session token, shown ONCE in a Dialog with
//      a copy button. The user pastes the token into the desktop app to
//      authenticate the socket.io tunnel.
//   3. Test invoke — pick a desktop, pick a tool, edit args JSON, Run, see the
//      result. Lets the user verify the bridge works end-to-end.
//   4. MCP tool catalog — the 9 tools the bridge exposes, with arg/return
//      shapes. Same list the mini-service serves at GET /tools.
//
// All actions hit /api/desktop/* routes (the Next.js side proxies /invoke to
// the desktop-bridge mini-service on port 3005). The user never talks to
// :3005 directly.

import * as React from 'react'
import { motion } from 'framer-motion'
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { MCP_TOOLS, type McpTool } from '@/lib/platform/desktop-tools'
import {
  Monitor,
  Plus,
  Copy,
  Check,
  Trash2,
  Play,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  Cable,
  FolderTree,
  Terminal,
  Globe,
  Bell,
  KeyRound,
  AlertCircle,
  CheckCircle2,
  XCircle,
} from 'lucide-react'

// ---------------- Types ----------------

interface DesktopSessionDto {
  id: string
  userId: string
  label: string
  platform: string | null
  arch: string | null
  appVersion: string | null
  status: string
  lastSeenAt: string | null
  capabilities: string[]
  createdAt: string
  updatedAt: string
}

interface CreatedSessionDto extends DesktopSessionDto {
  sessionToken: string
}

interface InvokeResultOk {
  ok: true
  result: unknown
}

interface InvokeResultErr {
  ok: false
  error: string
}

type InvokeResult = InvokeResultOk | InvokeResultErr

// ---------------- Inline TanStack Query hooks ----------------

const QK = {
  sessions: ['desktop-sessions'] as const,
  tools: ['desktop-tools'] as const,
}

async function j<T>(res: Promise<Response>): Promise<T> {
  const r = await res
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    throw new Error((e as { error?: string }).error || `Request failed: ${r.status}`)
  }
  return r.json() as Promise<T>
}

function useDesktopSessions() {
  return useQuery<{ sessions: DesktopSessionDto[] }>({
    queryKey: QK.sessions,
    queryFn: () =>
      j(fetch('/api/desktop/sessions').then((r) => r)),
    // Refresh online/offline status every 10s.
    refetchInterval: 10_000,
  })
}

function useCreateDesktopSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      label: string
      platform?: string
      arch?: string
      appVersion?: string
      capabilities?: string[]
    }) => {
      return j<CreatedSessionDto>(
        fetch('/api/desktop/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        }).then((r) => r),
      )
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.sessions })
    },
  })
}

function useRevokeDesktopSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      return j<{ ok: boolean }>(
        fetch(`/api/desktop/sessions/${id}`, { method: 'DELETE' }).then((r) => r),
      )
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.sessions })
    },
  })
}

function useInvokeDesktopTool() {
  return useMutation({
    mutationFn: async (input: {
      sessionId: string
      tool: string
      args: Record<string, unknown>
      timeoutMs?: number
    }) => {
      const res = await fetch('/api/desktop/bridge/invoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      const payload = (await res.json().catch(() => ({}))) as InvokeResult
      return { status: res.status, payload }
    },
  })
}

// ---------------- Helpers ----------------

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

const GROUP_ICON: Record<McpTool['group'], React.ComponentType<{ className?: string }>> = {
  fs: FolderTree,
  cli: Terminal,
  net: Globe,
  notify: Bell,
  secrets: KeyRound,
}

const GROUP_LABEL: Record<McpTool['group'], string> = {
  fs: 'Filesystem',
  cli: 'CLI',
  net: 'Network',
  notify: 'Notify',
  secrets: 'Secrets',
}

// ---------------- Panel ----------------

/**
 * DesktopBridgePanel — the user-facing settings panel for the Apical desktop
 * bridge. Renders:
 *   - Header with a one-line explainer.
 *   - Connected desktops list (online/offline badge + Revoke).
 *   - "Add desktop" button → Dialog minting a `dsk_` token shown once.
 *   - Test-invoke form (desktop + tool + args JSON → Run → result).
 *   - MCP tool catalog (9 tools).
 *
 * Self-contained: pulls its own data via TanStack Query (inline hooks). Wiring
 * into settings-view.tsx is a one-line `<DesktopBridgePanel />` render in the
 * `desktop` section.
 */
export function DesktopBridgePanel() {
  const { data, isLoading } = useDesktopSessions()
  const sessions = data?.sessions ?? []

  return (
    <TooltipProvider delayDuration={150}>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="space-y-5"
      >
        <Header />
        <SessionsList sessions={sessions} isLoading={isLoading} />
        <AddDesktopSection />
        <TestInvokeSection sessions={sessions} />
        <ToolCatalogSection />
      </motion.div>
    </TooltipProvider>
  )
}

export default DesktopBridgePanel

// ---------------- Sub-sections ----------------

function Header() {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Monitor className="h-4 w-4 text-primary" />
        <h2 className="text-base font-semibold">Desktop bridge</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Connect the Apical desktop app to give your agents secure, MCP-style
        access to your local filesystem, CLI, network, keychain, and
        notifications.
      </p>
    </div>
  )
}

function SessionsList({
  sessions,
  isLoading,
}: {
  sessions: DesktopSessionDto[]
  isLoading: boolean
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Connected desktops</h3>
        <span className="text-[11px] text-muted-foreground">
          {sessions.length} total · {sessions.filter((s) => s.status === 'online').length} online
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-6 text-center">
          <Cable className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No desktops connected yet. Add one below to get a session token.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((s, i) => (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: i * 0.03 }}
            >
              <SessionRow session={s} />
            </motion.div>
          ))}
        </div>
      )}
    </section>
  )
}

function SessionRow({ session }: { session: DesktopSessionDto }) {
  const revoke = useRevokeDesktopSession()
  const { toast } = useToast()
  const [confirming, setConfirming] = React.useState(false)
  const online = session.status === 'online'

  const platformLabel = [session.platform, session.arch]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      <div
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          online
            ? 'bg-primary/10 text-primary'
            : 'bg-muted text-muted-foreground',
        )}
      >
        <Monitor className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{session.label}</span>
          {online ? (
            <Badge className="gap-1 bg-primary/10 text-[9px] text-primary hover:bg-primary/10">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Online
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 text-[9px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
              Offline
            </Badge>
          )}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {platformLabel || 'Unknown platform'}
          {session.appVersion ? ` · v${session.appVersion}` : ''}
          {session.capabilities.length > 0 && ` · ${session.capabilities.join(', ')}`}
        </div>
        <div className="mt-0.5 text-[10px] text-muted-foreground/80">
          Last seen {relativeTime(session.lastSeenAt)}
        </div>
      </div>

      <div className="shrink-0">
        {confirming ? (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-[11px]"
              disabled={revoke.isPending}
              onClick={() => {
                revoke.mutate(session.id, {
                  onSuccess: () => {
                    toast({ title: 'Desktop revoked', description: session.label })
                    setConfirming(false)
                  },
                  onError: (err) => {
                    toast({
                      title: 'Failed to revoke',
                      description: err.message,
                      variant: 'destructive',
                    })
                  },
                })
              }}
            >
              {revoke.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirm'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11px]"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[11px] text-muted-foreground hover:text-destructive"
                onClick={() => setConfirming(true)}
              >
                <Trash2 className="h-3 w-3" /> Revoke
              </Button>
            </TooltipTrigger>
            <TooltipContent>Disconnect + delete this desktop session</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
}

function AddDesktopSection() {
  const create = useCreateDesktopSession()
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [label, setLabel] = React.useState('')
  const [created, setCreated] = React.useState<CreatedSessionDto | null>(null)
  const [copied, setCopied] = React.useState(false)

  const handleOpen = (next: boolean) => {
    if (!next) {
      // Closing the dialog clears the created token so it can't be re-shown.
      setCreated(null)
      setLabel('')
      setCopied(false)
    }
    setOpen(next)
  }

  const handleCreate = () => {
    create.mutate(
      {
        label: label.trim() || 'My Desktop',
        // Best-effort: detect platform/arch from the browser UA.
        platform: detectPlatform(),
        arch: detectArch(),
      },
      {
        onSuccess: (row) => {
          setCreated(row)
          toast({ title: 'Desktop session created', description: row.label })
        },
        onError: (err) => {
          toast({
            title: 'Failed to create session',
            description: err.message,
            variant: 'destructive',
          })
        },
      },
    )
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Add a desktop</h3>
      <p className="text-[11px] text-muted-foreground">
        Mint a session token, then paste it into the desktop app's sign-in
        screen. The token is shown <strong>once</strong> — copy it before
        closing this dialog.
      </p>

      <Dialog open={open} onOpenChange={handleOpen}>
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={() => handleOpen(true)}
        >
          <Plus className="h-4 w-4" /> Add desktop
        </Button>

        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {created ? 'Desktop session ready' : 'Add a desktop'}
            </DialogTitle>
            <DialogDescription>
              {created
                ? 'Copy this token and paste it into the Apical desktop app. You will not be able to see it again.'
                : 'Mint a session token the desktop app will use to authenticate.'}
            </DialogDescription>
          </DialogHeader>

          {created ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                <Label className="text-[10px] uppercase tracking-wide text-primary">
                  Session token
                </Label>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 break-all rounded bg-card px-2 py-1.5 font-mono text-[11px]">
                    {created.sessionToken}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => {
                      navigator.clipboard.writeText(created.sessionToken)
                      setCopied(true)
                      toast({ title: 'Token copied' })
                      setTimeout(() => setCopied(false), 1500)
                    }}
                  >
                    {copied ? (
                      <Check className="h-3 w-3 text-primary" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              </div>
              <div className="rounded-lg bg-muted/40 p-2 text-[11px] text-muted-foreground">
                <div className="mb-1 flex items-center gap-1 font-medium text-foreground">
                  <ShieldCheck className="h-3 w-3 text-primary" /> How to use it
                </div>
                Open the Apical desktop app → Sign in with session token →
                paste the token above. The app will connect over a secure
                WebSocket tunnel and expose 9 MCP tools to your agents.
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Label</Label>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="My Desktop"
                  className="mt-1"
                  autoFocus
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  A friendly name to identify this desktop later.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            {created ? (
              <Button onClick={() => handleOpen(false)}>Done</Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => handleOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={create.isPending}
                >
                  {create.isPending ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Plus className="mr-1 h-3 w-3" />
                  )}
                  Mint token
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function TestInvokeSection({ sessions }: { sessions: DesktopSessionDto[] }) {
  const invoke = useInvokeDesktopTool()
  const { toast } = useToast()

  const [sessionId, setSessionId] = React.useState('')
  const [toolName, setToolName] = React.useState(MCP_TOOLS[0].name)
  const [argsText, setArgsText] = React.useState('{}')
  const [result, setResult] = React.useState<
    | { kind: 'idle' }
    | { kind: 'running' }
    | { kind: 'ok'; result: unknown }
    | { kind: 'err'; error: string; status?: number }
  >({ kind: 'idle' })

  // Auto-pick the first session when one becomes available.
  React.useEffect(() => {
    if (!sessionId && sessions.length > 0) {
      setSessionId(sessions[0].id)
    }
  }, [sessions, sessionId])

  // When the tool changes, prefill the args textarea with a sensible default.
  React.useEffect(() => {
    const t = MCP_TOOLS.find((x) => x.name === toolName)
    if (!t) return
    setArgsText(defaultArgsFor(t))
  }, [toolName])

  const handleRun = async () => {
    if (!sessionId) {
      toast({ title: 'Pick a desktop first', variant: 'destructive' })
      return
    }
    let args: Record<string, unknown>
    try {
      args = argsText.trim() ? JSON.parse(argsText) : {}
      if (args === null || typeof args !== 'object' || Array.isArray(args)) {
        throw new Error('args must be a JSON object')
      }
    } catch (err) {
      setResult({
        kind: 'err',
        error: `Invalid args JSON: ${err instanceof Error ? err.message : String(err)}`,
      })
      return
    }

    setResult({ kind: 'running' })
    invoke.mutate(
      { sessionId, tool: toolName, args },
      {
        onSuccess: ({ status, payload }) => {
          if (payload.ok) {
            setResult({ kind: 'ok', result: payload.result })
          } else {
            setResult({ kind: 'err', error: payload.error, status })
            toast({
              title: status === 503 ? 'Desktop offline' : 'Invoke failed',
              description: payload.error,
              variant: 'destructive',
            })
          }
        },
        onError: (err) => {
          setResult({ kind: 'err', error: err.message })
        },
      },
    )
  }

  const selectedSession = sessions.find((s) => s.id === sessionId)
  const isOnline = selectedSession?.status === 'online'

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Test invoke</h3>
      <p className="text-[11px] text-muted-foreground">
        Pick a connected desktop + a tool, edit the args JSON, and Run. Lets you
        verify the tunnel works end-to-end before wiring tools into a workflow.
      </p>

      <div className="rounded-xl border border-border bg-card p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Desktop
            </Label>
            <Select value={sessionId} onValueChange={setSessionId}>
              <SelectTrigger className="mt-1 h-8 text-xs">
                <SelectValue placeholder="Pick a desktop" />
              </SelectTrigger>
              <SelectContent>
                {sessions.length === 0 ? (
                  <SelectItem value="__none" disabled>
                    No desktops — add one above
                  </SelectItem>
                ) : (
                  sessions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            s.status === 'online' ? 'bg-primary' : 'bg-muted-foreground/60',
                          )}
                        />
                        {s.label}
                      </span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Tool
            </Label>
            <Select value={toolName} onValueChange={setToolName}>
              <SelectTrigger className="mt-1 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MCP_TOOLS.map((t) => (
                  <SelectItem key={t.name} value={t.name}>
                    <span className="font-mono text-[11px]">{t.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-2">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Args (JSON)
          </Label>
          <Textarea
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            spellCheck={false}
            className="mt-1 min-h-[80px] font-mono text-[11px]"
          />
        </div>

        <div className="mt-2 flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleRun}
            disabled={invoke.isPending || !sessionId || !isOnline}
          >
            {invoke.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Play className="mr-1 h-3 w-3" />
            )}
            Run
          </Button>
          {selectedSession && !isOnline && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <AlertCircle className="h-3 w-3" /> Desktop is offline
            </span>
          )}
        </div>

        {result.kind !== 'idle' && (
          <div className="mt-3">
            <div className="mb-1 flex items-center gap-2">
              {result.kind === 'running' ? (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              ) : result.kind === 'ok' ? (
                <CheckCircle2 className="h-3 w-3 text-primary" />
              ) : (
                <XCircle className="h-3 w-3 text-destructive" />
              )}
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {result.kind === 'running'
                  ? 'Running'
                  : result.kind === 'ok'
                    ? 'Result'
                    : `Error${result.status ? ` · HTTP ${result.status}` : ''}`}
              </span>
            </div>
            <pre className="max-h-48 overflow-auto rounded-lg bg-muted/50 p-2 font-mono text-[10px]">
              {result.kind === 'running'
                ? '...'
                : result.kind === 'ok'
                  ? JSON.stringify(result.result, null, 2)
                  : result.error}
            </pre>
          </div>
        )}
      </div>
    </section>
  )
}

function ToolCatalogSection() {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">MCP tool catalog</h3>
        <Badge variant="outline" className="text-[9px]">
          {MCP_TOOLS.length} tools
        </Badge>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Tools hosted agents can call against a connected desktop. Same catalog
        the bridge serves at <code className="font-mono">GET /tools</code>.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        {MCP_TOOLS.map((t, i) => {
          const Icon = GROUP_ICON[t.group]
          return (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: i * 0.02 }}
              className="rounded-xl border border-border bg-card p-3"
            >
              <div className="mb-1 flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-3 w-3" />
                </div>
                <code className="font-mono text-[11px] font-medium">{t.name}</code>
                <Badge
                  variant="outline"
                  className="ml-auto text-[9px] text-muted-foreground"
                >
                  {GROUP_LABEL[t.group]}
                </Badge>
              </div>
              <p className="mb-2 text-[11px] text-muted-foreground">{t.description}</p>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <div className="mb-0.5 text-[9px] uppercase tracking-wide text-muted-foreground/70">
                    Args
                  </div>
                  <ul className="space-y-0.5">
                    {Object.entries(t.args).map(([k, v]) => (
                      <li key={k} className="flex gap-1">
                        <code className="font-mono text-primary/80">{k}</code>
                        <span className="text-muted-foreground">{v}</span>
                      </li>
                    ))}
                    {Object.keys(t.args).length === 0 && (
                      <li className="text-muted-foreground/60">none</li>
                    )}
                  </ul>
                </div>
                <div>
                  <div className="mb-0.5 text-[9px] uppercase tracking-wide text-muted-foreground/70">
                    Returns
                  </div>
                  <ul className="space-y-0.5">
                    {Object.entries(t.returns).map(([k, v]) => (
                      <li key={k} className="flex gap-1">
                        <code className="font-mono text-primary/80">{k}</code>
                        <span className="text-muted-foreground">{v}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>

      <div className="mt-2 flex items-start gap-2 rounded-lg border border-border bg-card/40 p-2 text-[11px] text-muted-foreground">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <div>
          Every invoke is dispatched from the connected desktop app — your
          machine runs the tool, Apical just relays the request over a secure
          WebSocket tunnel. Revoking a desktop immediately disconnects it.
        </div>
      </div>
    </section>
  )
}

// ---------------- Small utils ----------------

function defaultArgsFor(t: McpTool): string {
  const samples: Record<string, Record<string, unknown>> = {
    'desktop.fs.list': { path: '/Users/me/Desktop' },
    'desktop.fs.read': { path: '/Users/me/notes.txt', encoding: 'utf8' },
    'desktop.fs.write': {
      path: '/Users/me/notes.txt',
      content: 'hello world',
      encoding: 'utf8',
    },
    'desktop.fs.move': { from: '/Users/me/a.txt', to: '/Users/me/b.txt' },
    'desktop.fs.watch': { path: '/Users/me/Desktop' },
    'desktop.cli.run': {
      cmd: 'echo',
      args: ['hello'],
      cwd: '/Users/me',
      timeoutMs: 5000,
    },
    'desktop.net.fetch': {
      url: 'https://api.github.com/zen',
      method: 'GET',
    },
    'desktop.notify': { title: 'Apical', body: 'Hello from your agent' },
    'desktop.secrets.get': { key: 'apical/test' },
  }
  return JSON.stringify(samples[t.name] ?? {}, null, 2)
}

function detectPlatform(): string | undefined {
  if (typeof navigator === 'undefined') return undefined
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('mac')) return 'macos'
  if (ua.includes('win')) return 'windows'
  if (ua.includes('linux')) return 'linux'
  return undefined
}

function detectArch(): string | undefined {
  if (typeof navigator === 'undefined') return undefined
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('arm')) return 'arm64'
  if (ua.includes('wow64') || ua.includes('x64')) return 'x86_64'
  // navigator.userAgentData?.architecture (Chromium) — best-effort.
  const ad = (navigator as unknown as {
    userAgentData?: { architecture?: string }
  }).userAgentData
  return ad?.architecture
}
