'use client'

import * as React from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useAppStore } from '@/lib/store'
import { useProfile, useUpdateProfile, useWorkflows, useUpdateWorkflow } from '@/lib/queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  ArrowLeft, User, Palette, KeyRound, LogOut, X,
  Sparkles, Check, Copy, Plus, Trash2, Moon, Sun,
} from 'lucide-react'
import { useTheme } from 'next-themes'

type SettingsSection = 'profile' | 'appearance' | 'agents' | 'account'

const SECTIONS: { key: SettingsSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'profile', label: 'Profile', icon: User },
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'agents', label: 'Agent naming', icon: Sparkles },
  { key: 'account', label: 'Account', icon: LogOut },
]

export function SettingsView() {
  const [section, setSection] = React.useState<SettingsSection>('profile')
  const setMode = useAppStore((s) => s.setMode)

  return (
    <div className="flex h-full overflow-hidden">
      {/* Section rail */}
      <nav className="hidden md:flex w-44 shrink-0 flex-col gap-0.5 border-r border-border p-2">
        <button onClick={() => setMode('chat')} className="mb-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        {SECTIONS.map((s) => (
          <button key={s.key} onClick={() => setSection(s.key)}
            className={cn('flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
              section === s.key ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')}>
            <s.icon className="h-3.5 w-3.5" /> {s.label}
          </button>
        ))}
      </nav>

      {/* Mobile section picker */}
      <div className="md:hidden flex overflow-x-auto border-b border-border px-2 py-1.5 gap-1">
        {SECTIONS.map((s) => (
          <button key={s.key} onClick={() => setSection(s.key)}
            className={cn('flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium',
              section === s.key ? 'bg-primary/10 text-foreground' : 'text-muted-foreground')}>
            <s.icon className="h-3 w-3" /> {s.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-5 md:px-6">
          {section === 'profile' && <ProfileSection />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'agents' && <AgentNamingSection />}
          {section === 'account' && <AccountSection />}
        </div>
      </div>
    </div>
  )
}

function ProfileSection() {
  const { data: session } = useSession()
  const { data: profile, isLoading } = useProfile()
  const updateProfile = useUpdateProfile()
  const { toast } = useToast()
  const [companyName, setCompanyName] = React.useState('')
  const [industry, setIndustry] = React.useState('')
  const [notes, setNotes] = React.useState('')

  React.useEffect(() => {
    if (profile) {
      setCompanyName(profile.companyName || '')
      setIndustry(profile.industry || '')
      setNotes(profile.notes || '')
    }
  }, [profile])

  const save = async () => {
    await updateProfile.mutateAsync({ companyName, industry, notes })
    toast({ title: 'Profile saved' })
  }

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Profile</h2>
        <p className="text-sm text-muted-foreground">Tell Apical about your business so it can tailor suggestions.</p>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
          {session?.user?.name?.[0]?.toUpperCase() ?? 'D'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{session?.user?.name ?? 'Developer'}</div>
          <div className="truncate text-xs text-muted-foreground">{session?.user?.email ?? 'dev@apical.local'}</div>
        </div>
        <Badge variant="outline" className="text-[10px]">{session?.user?.provider ?? 'dev'}</Badge>
      </div>

      <div className="space-y-3">
        <div>
          <Label className="text-xs">Company name</Label>
          <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Acme Co" className="text-sm" />
        </div>
        <div>
          <Label className="text-xs">Industry</Label>
          <Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Professional services" className="text-sm" />
        </div>
        <div>
          <Label className="text-xs">Notes (what does your business do?)</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="We use Gmail, QuickBooks, and a scanner for paper docs…" rows={3} className="text-sm" />
        </div>
        <Button onClick={save} disabled={updateProfile.isPending} className="text-xs">
          <Check className="mr-1 h-3 w-3" /> Save profile
        </Button>
      </div>
    </div>
  )
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Appearance</h2>
        <p className="text-sm text-muted-foreground">Choose how Apical looks.</p>
      </div>
      <div className="space-y-2">
        <Label className="text-xs">Theme</Label>
        <div className="flex gap-2">
          {([
            { key: 'light', label: 'Light', icon: Sun },
            { key: 'dark', label: 'Dark', icon: Moon },
          ] as const).map((t) => (
            <button key={t.key} onClick={() => setTheme(t.key)}
              className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                mounted && theme === t.key ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:border-primary/30')}>
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function AgentNamingSection() {
  const { data: profile } = useProfile()
  const updateProfile = useUpdateProfile()
  const { toast } = useToast()
  const [style, setStyle] = React.useState<'evocative' | 'descriptive'>(profile?.agentNameStyle ?? 'descriptive')

  React.useEffect(() => {
    if (profile?.agentNameStyle) setStyle(profile.agentNameStyle as 'evocative' | 'descriptive')
  }, [profile?.agentNameStyle])

  const save = async () => {
    await updateProfile.mutateAsync({ agentNameStyle: style } as never)
    toast({ title: 'Naming style saved' })
  }

  const examples = {
    evocative: ['Nomi', 'Vexa', 'Kiro', 'Mavo', 'Sova', 'Lumo', 'Talo', 'Vero', 'Oryn'],
    descriptive: ['SortAgent', 'InvoiceAgent', 'AuditAgent', 'DigestAgent', 'ScanAgent', 'MailAgent'],
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Agent naming</h2>
        <p className="text-sm text-muted-foreground">How should Apical name new agents it creates for you?</p>
      </div>
      <div className="space-y-2">
        {([
          { key: 'evocative' as const, label: 'Evocative names', desc: 'Short, memorable names like Nomi, Vexa, Kiro', examples: examples.evocative },
          { key: 'descriptive' as const, label: 'Descriptive names', desc: 'Functional names like SortAgent, InvoiceAgent', examples: examples.descriptive },
        ]).map((opt) => (
          <button key={opt.key} onClick={() => setStyle(opt.key)}
            className={cn('flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors',
              style === opt.key ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30')}>
            <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
              style === opt.key ? 'border-primary bg-primary' : 'border-muted-foreground/40')}>
              {style === opt.key && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{opt.label}</div>
              <div className="text-[11px] text-muted-foreground">{opt.desc}</div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {opt.examples.slice(0, 5).map((n) => (
                  <span key={n} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{n}</span>
                ))}
              </div>
            </div>
          </button>
        ))}
      </div>
      <Button onClick={save} disabled={updateProfile.isPending} className="text-xs">
        <Check className="mr-1 h-3 w-3" /> Save preference
      </Button>
    </div>
  )
}

export function TokensSection() {
  const [tokens, setTokens] = React.useState<Array<{ id: string; label: string; prefix: string; status: string; lastUsedAt: string | null; createdAt: string }>>([])
  const [newLabel, setNewLabel] = React.useState('')
  const [newRaw, setNewRaw] = React.useState<string | null>(null)
  const { toast } = useToast()

  const load = React.useCallback(async () => {
    const r = await fetch('/api/auth/pat')
    if (r.ok) {
      const data = await r.json()
      setTokens(Array.isArray(data) ? data : data.tokens ?? [])
    }
  }, [])
  React.useEffect(() => { load() }, [load])

  const create = async () => {
    if (!newLabel.trim()) return
    const r = await fetch('/api/auth/pat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: newLabel.trim() }) })
    if (r.ok) {
      const data = await r.json()
      setNewRaw(data.raw)
      setNewLabel('')
      toast({ title: 'Token created' })
      load()
    }
  }

  const revoke = async (id: string) => {
    await fetch(`/api/auth/pat/${id}`, { method: 'DELETE' })
    toast({ title: 'Token revoked' })
    load()
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Access tokens</h2>
        <p className="text-sm text-muted-foreground">Personal access tokens authenticate the MCP server and REST API. Treated like passwords — shown once.</p>
      </div>

      {newRaw && (
        <div className="space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
          <div className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-500" /><span className="text-sm font-medium">Copy this now — it won't be shown again</span></div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-card px-2 py-1 font-mono text-xs">{newRaw}</code>
            <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(newRaw); toast({ title: 'Copied' }) }}><Copy className="h-3 w-3" /></Button>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setNewRaw(null)}>Dismiss</Button>
        </div>
      )}

      <div className="flex gap-2">
        <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Token label (e.g. Cursor, Claude)" className="text-sm" onKeyDown={(e) => e.key === 'Enter' && create()} />
        <Button onClick={create} disabled={!newLabel.trim()}><Plus className="mr-1 h-3 w-3" /> Create</Button>
      </div>

      <div className="space-y-2">
        {tokens.map((t) => (
          <div key={t.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
            <KeyRound className={cn('h-4 w-4 shrink-0', t.status === 'active' ? 'text-primary' : 'text-muted-foreground')} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{t.label}</span>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{t.prefix}…</code>
                {t.status === 'revoked' && <Badge variant="destructive" className="text-[9px]">Revoked</Badge>}
              </div>
              <div className="text-[11px] text-muted-foreground">{t.lastUsedAt ? `Last used ${new Date(t.lastUsedAt).toLocaleDateString()}` : 'Never used'}</div>
            </div>
            {t.status === 'active' && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => revoke(t.id)}><Trash2 className="h-3 w-3" /></Button>}
          </div>
        ))}
        {tokens.length === 0 && <p className="text-xs text-muted-foreground">No tokens yet. Create one to connect your AI editor via MCP.</p>}
      </div>
    </div>
  )
}

function AccountSection() {
  const { data: session } = useSession()
  const { toast } = useToast()

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Account</h2>
        <p className="text-sm text-muted-foreground">Manage your account session.</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {session?.user?.name?.[0]?.toUpperCase() ?? 'D'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{session?.user?.name ?? 'Developer'}</div>
            <div className="truncate text-xs text-muted-foreground">{session?.user?.email ?? 'dev@apical.local'}</div>
          </div>
        </div>
      </div>

      <Button variant="outline" className="w-full text-xs" onClick={() => {
        signOut({ callbackUrl: '/login' })
        toast({ title: 'Signed out' })
      }}>
        <LogOut className="mr-1 h-3 w-3" /> Sign out
      </Button>

      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
        <h3 className="text-sm font-medium text-destructive">Danger zone</h3>
        <p className="mt-1 text-xs text-muted-foreground">Delete your account and all associated data. This cannot be undone.</p>
        <Button variant="destructive" size="sm" className="mt-2 text-xs" onClick={() => toast({ title: 'Contact support to delete your account' })}>
          Delete account
        </Button>
      </div>
    </div>
  )
}
