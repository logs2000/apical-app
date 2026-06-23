'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  useOAuthProviders,
  useCredentials,
  useOAuthStart,
  useOAuthDemoConnect,
  useOAuthDisconnect,
} from '@/lib/queries'
import type { OAuthProvider } from '@/lib/types'
import {
  Search,
  Check,
  Plug,
  PlugZap,
  Loader2,
  ExternalLink,
  Info,
  Unplug,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'

// Category display order + labels.
const CATEGORY_ORDER = [
  'email',
  'messaging',
  'dev',
  'crm',
  'finance',
  'files',
  'general',
] as const

const CATEGORY_LABELS: Record<string, string> = {
  email: 'Email',
  messaging: 'Messaging',
  dev: 'Developer',
  crm: 'CRM',
  finance: 'Finance',
  files: 'Files',
  general: 'General',
}

/**
 * The "Connect your accounts" section.
 *
 * Renders the OAuth provider catalog as a grid grouped by category. Each card
 * shows the provider's icon, name, description, and a Connect/Connected
 * button. The button behavior depends on the provider's config:
 *
 *   - hasClientId === true  → real OAuth (operator has set Apical's clientId).
 *   - hasClientId === false && demoMode === true → demo connection.
 *   - hasClientId === false && supportsCustomCreds === true && demoMode === false
 *     → dialog asking the user for their own clientId/clientSecret (BYO).
 *
 * On success/error from the OAuth redirect (?oauth_success=google /
 * ?oauth_error=msg), shows a toast.
 */
export function OAuthConnect() {
  const { data: providers, isLoading } = useOAuthProviders()
  const { data: credentials } = useCredentials()
  const { toast } = useToast()
  const [search, setSearch] = React.useState('')

  // ---------------- Handle OAuth redirect result ----------------
  // On mount, read ?oauth_success= or ?oauth_error= and toast. Then strip them
  // from the URL so they don't linger on refresh.
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const success = url.searchParams.get('oauth_success')
    const error = url.searchParams.get('oauth_error')
    if (success) {
      toast({
        title: 'Connected',
        description: `Your ${success} account is now connected.`,
      })
    } else if (error) {
      toast({
        title: 'Connection failed',
        description: decodeURIComponent(error),
        variant: 'destructive',
      })
    }
    if (success || error) {
      url.searchParams.delete('oauth_success')
      url.searchParams.delete('oauth_error')
      window.history.replaceState({}, '', url.toString())
    }
  }, [toast])

  // ---------------- Group + filter ----------------
  const connectedProviders = React.useMemo(() => {
    const set = new Set<string>()
    for (const c of credentials ?? []) {
      if (c.oauthProvider && c.status === 'active') set.add(c.oauthProvider)
    }
    return set
  }, [credentials])

  const connectedDemoProviders = React.useMemo(() => {
    const set = new Set<string>()
    for (const c of credentials ?? []) {
      if (
        c.oauthProvider &&
        c.status === 'active' &&
        c.meta?.connectedVia === 'demo'
      ) {
        set.add(c.oauthProvider)
      }
    }
    return set
  }, [credentials])

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return providers ?? []
    return (providers ?? []).filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.key.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q),
    )
  }, [providers, search])

  const grouped = React.useMemo(() => {
    const map = new Map<string, OAuthProvider[]>()
    for (const p of filtered) {
      const arr = map.get(p.category) ?? []
      arr.push(p)
      map.set(p.category, arr)
    }
    // Sort groups by CATEGORY_ORDER; unknown categories appended.
    const sorted: Array<{ category: string; items: OAuthProvider[] }> = []
    for (const cat of CATEGORY_ORDER) {
      const items = map.get(cat)
      if (items && items.length) sorted.push({ category: cat, items })
    }
    for (const [cat, items] of map.entries()) {
      if (!CATEGORY_ORDER.includes(cat as (typeof CATEGORY_ORDER)[number])) {
        sorted.push({ category: cat, items })
      }
    }
    return sorted
  }, [filtered])

  const connectedCount = connectedProviders.size

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <PlugZap className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">Connections</h2>
          {connectedCount > 0 && (
            <Badge variant="outline" className="border-primary/40 text-primary text-[10px]">
              {connectedCount} connected
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          One-click connect Gmail, GitHub, Slack, Notion, and more. Apical uses these connections to run your workflows — no API keys to paste.
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search providers…"
          className="h-9 pl-8 text-sm"
        />
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No providers match &ldquo;{search}&rdquo;.
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map((group, gi) => (
            <motion.div
              key={group.category}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: gi * 0.04, duration: 0.2 }}
              className="space-y-2"
            >
              <div className="flex items-center gap-2 px-0.5">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {CATEGORY_LABELS[group.category] ?? group.category}
                </h3>
                <span className="text-[10px] text-muted-foreground/70">
                  {group.items.length}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((p, i) => (
                  <ProviderCard
                    key={p.id}
                    provider={p}
                    connected={connectedProviders.has(p.key)}
                    isDemo={connectedDemoProviders.has(p.key)}
                    delay={gi * 0.04 + i * 0.02}
                  />
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Helper note */}
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          <span className="font-medium text-foreground">Demo mode:</span>{' '}
          Apical isn&apos;t configured with real OAuth client IDs in this environment, so connections are simulated.
          In production, set each provider&apos;s <code className="font-mono">clientId</code>/<code className="font-mono">clientSecret</code>{' '}
          (or use <span className="font-medium">bring-your-own</span> per provider) for live API access.
        </div>
      </div>
    </div>
  )
}

// ---------------- Single provider card ----------------

function ProviderCard({
  provider,
  connected,
  isDemo,
  delay,
}: {
  provider: OAuthProvider
  connected: boolean
  isDemo: boolean
  delay: number
}) {
  const { toast } = useToast()
  const startMut = useOAuthStart()
  const demoMut = useOAuthDemoConnect()
  const disconnectMut = useOAuthDisconnect()
  const [byoOpen, setByoOpen] = React.useState(false)
  const [byoClientId, setByoClientId] = React.useState('')
  const [byoClientSecret, setByoClientSecret] = React.useState('')

  const isBusy = startMut.isPending || demoMut.isPending || disconnectMut.isPending
  const isComing = provider.status === 'coming_soon'

  const handleConnect = async () => {
    if (isComing) return
    // 1. Real OAuth (Apical has clientId configured).
    if (provider.hasClientId) {
      try {
        const res = await startMut.mutateAsync({ provider: provider.key })
        if (res.demoMode) {
          // Provider's clientId is empty + demoMode is true → fall through to demo.
          await runDemo(provider.key)
        } else if (res.authorizationUrl) {
          window.location.assign(res.authorizationUrl)
        }
      } catch (err) {
        toast({
          title: 'Could not start OAuth',
          description: err instanceof Error ? err.message : 'Unknown error',
          variant: 'destructive',
        })
      }
      return
    }
    // 2. No client id → demo mode (if available).
    if (provider.demoMode) {
      await runDemo(provider.key)
      return
    }
    // 3. Supports BYO → open the dialog.
    if (provider.supportsCustomCreds) {
      setByoOpen(true)
      return
    }
    // 4. Nothing we can do.
    toast({
      title: `${provider.name} is not connectable yet`,
      description: 'No OAuth client configured and demo mode is off.',
      variant: 'destructive',
    })
  }

  const runDemo = async (key: string) => {
    try {
      await demoMut.mutateAsync({ provider: key })
      toast({
        title: `Connected ${provider.name} (demo)`,
        description: 'Simulated connection — no real OAuth was performed.',
      })
    } catch (err) {
      toast({
        title: 'Connection failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    }
  }

  const handleByoSubmit = async () => {
    if (!byoClientId.trim() || !byoClientSecret.trim()) return
    try {
      const res = await startMut.mutateAsync({
        provider: provider.key,
        customClientId: byoClientId.trim(),
        customClientSecret: byoClientSecret.trim(),
      })
      if (res.demoMode) {
        // Server decided demo was appropriate (shouldn't happen when BYO is provided).
        await runDemo(provider.key)
      } else if (res.authorizationUrl) {
        setByoOpen(false)
        window.location.assign(res.authorizationUrl)
      }
    } catch (err) {
      toast({
        title: 'Could not start OAuth',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    }
  }

  const handleDisconnect = async () => {
    try {
      await disconnectMut.mutateAsync({ provider: provider.key })
      toast({
        title: `Disconnected ${provider.name}`,
        description: 'The credential has been revoked.',
      })
    } catch (err) {
      toast({
        title: 'Could not disconnect',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.2 }}
      className={cn(
        'group relative flex flex-col gap-2 rounded-xl border bg-card p-3.5 transition-colors',
        connected
          ? 'border-primary/40 hover:border-primary/60'
          : 'border-border hover:border-primary/30',
      )}
    >
      {/* Header: icon + name + status */}
      <div className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-lg"
          aria-hidden
        >
          {provider.icon || '🔌'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{provider.name}</span>
            {isDemo && (
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/5 px-1 py-0 text-[9px] text-amber-600 dark:text-amber-400"
              >
                <Sparkles className="mr-0.5 h-2.5 w-2.5" /> demo
              </Badge>
            )}
            {isComing && (
              <Badge variant="outline" className="text-[9px] text-muted-foreground">
                soon
              </Badge>
            )}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {provider.description || provider.category}
          </div>
        </div>
        {connected && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <Check className="h-3 w-3" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                Connected
                {isDemo ? ' (demo mode)' : ''}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Footer: scopes + action */}
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          {provider.scopes ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block truncate font-mono text-[9px] text-muted-foreground/70">
                    {provider.scopes}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <span className="font-mono text-[10px]">{provider.scopes}</span>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <span className="text-[9px] text-muted-foreground/50">No scopes</span>
          )}
        </div>

        {connected ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDisconnect}
            disabled={isBusy}
            className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
          >
            {disconnectMut.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Unplug className="h-3 w-3" />
            )}
            <span className="ml-1">Disconnect</span>
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleConnect}
            disabled={isBusy || isComing}
            className="h-7 px-2.5 text-[11px]"
          >
            {startMut.isPending || demoMut.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Plug className="h-3 w-3" />
            )}
            <span className="ml-1">Connect</span>
          </Button>
        )}
      </div>

      {/* BYO credentials dialog */}
      <Dialog open={byoOpen} onOpenChange={setByoOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>{provider.icon || '🔌'}</span>
              <span>Bring your own {provider.name} credentials</span>
            </DialogTitle>
            <DialogDescription>
              Apical doesn&apos;t have OAuth credentials for {provider.name} configured. Create an OAuth
              app at the provider&apos;s developer console, then paste your client id and secret here.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] text-amber-700 dark:text-amber-400">
              <div className="flex items-start gap-1.5">
                <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
                <div>
                  Set this exact URL as the authorized redirect URI in your OAuth app:{' '}
                  <code className="font-mono text-[10px]">
                    {typeof window !== 'undefined' ? window.location.origin : 'https://your-app'}/api/oauth/callback
                  </code>
                </div>
              </div>
            </div>
            <div>
              <Label className="text-xs">Client ID</Label>
              <Input
                value={byoClientId}
                onChange={(e) => setByoClientId(e.target.value)}
                placeholder="e.g. 1234567890-abc.apps.googleusercontent.com"
                className="font-mono text-sm"
                  autoComplete="off"
                  spellCheck={false}
              />
            </div>
            <div>
              <Label className="text-xs">Client secret</Label>
              <Input
                type="password"
                value={byoClientSecret}
                onChange={(e) => setByoClientSecret(e.target.value)}
                placeholder="Your OAuth client secret"
                className="font-mono text-sm"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <ExternalLink className="h-3 w-3" />
              <span>
                Need help?{' '}
                <a
                  href={provider.authorizationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  Open {provider.name}&apos;s OAuth docs
                </a>
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setByoOpen(false)} className="text-xs">
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleByoSubmit}
              disabled={
                !byoClientId.trim() ||
                !byoClientSecret.trim() ||
                startMut.isPending
              }
              className="text-xs"
            >
              {startMut.isPending ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Plug className="mr-1 h-3 w-3" />
              )}
              Connect with my credentials
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
