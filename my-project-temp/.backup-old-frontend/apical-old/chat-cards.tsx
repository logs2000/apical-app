'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import {
  HelpCircle,
  Radio,
  ArrowRight,
  SkipForward,
  Search,
  Plug,
  KeyRound,
  Check,
  Loader2,
  Lock,
  Sparkles,
  Globe,
  FileCode2,
  Code2,
  ExternalLink,
  Plus,
} from 'lucide-react'
import type {
  ClarificationQuestion,
  ApiDiscoveryCandidate,
  ChatMessage,
  ResearchResult,
  ScriptAnalysis,
} from '@/lib/types'
import { useSaveCredential } from '@/lib/queries'

// ---------------- Clarification question card ----------------
export function ClarificationCard({
  question,
  onAnswer,
  onSkip,
}: {
  question: ClarificationQuestion
  onAnswer: (optionKey: string, customText?: string) => void
  onSkip?: () => void
}) {
  const [selected, setSelected] = React.useState<string | null>(null)
  const [custom, setCustom] = React.useState('')
  const [showCustom, setShowCustom] = React.useState(false)

  const letters = ['A', 'B', 'C', 'D', 'E', 'F']

  const handleContinue = () => {
    if (showCustom) {
      onAnswer('other', custom.trim() || undefined)
    } else if (selected) {
      onAnswer(selected)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
        <HelpCircle className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">Question</span>
        <span className="ml-auto text-[10px] text-muted-foreground">Clarification needed</span>
      </div>

      {/* Question + options */}
      <div className="p-3">
        <p className="mb-2.5 text-sm font-medium leading-snug">{question.question}</p>
        <div className="space-y-1.5">
          {question.options.map((opt, i) => {
            const isSel = selected === opt.key && !showCustom
            return (
              <button
                key={opt.key}
                onClick={() => {
                  setSelected(opt.key)
                  setShowCustom(false)
                }}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
                  isSel
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/40 hover:bg-accent/40',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                    isSel ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
                  )}
                >
                  {isSel && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
                </span>
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border font-mono text-[10px] font-semibold text-muted-foreground">
                  {letters[i]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium">{opt.label}</div>
                  {opt.description && (
                    <div className="text-[11px] text-muted-foreground">{opt.description}</div>
                  )}
                </div>
              </button>
            )
          })}
          {/* "Other..." option */}
          <button
            onClick={() => {
              setShowCustom(true)
              setSelected(null)
            }}
            className={cn(
              'flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
              showCustom ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40 hover:bg-accent/40',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                showCustom ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
              )}
            >
              {showCustom && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
            </span>
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border font-mono text-[10px] font-semibold text-muted-foreground">
              {letters[question.options.length]}
            </span>
            <span className="text-xs text-muted-foreground">Other…</span>
          </button>
        </div>

        {showCustom && (
          <Textarea
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Describe what you want…"
            rows={2}
            className="mt-2 text-xs"
            autoFocus
          />
        )}

        {/* Actions */}
        <div className="mt-3 flex items-center justify-end gap-2">
          {onSkip && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onSkip}>
              <SkipForward className="mr-1 h-3 w-3" />
              Skip
            </Button>
          )}
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={!selected && !(showCustom && custom.trim())}
            onClick={handleContinue}
          >
            Continue
            <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        </div>
      </div>
    </motion.div>
  )
}

// ---------------- API discovery + credential input card ----------------
export function ApiDiscoveryCard({
  candidates,
  onConnected,
}: {
  candidates: ApiDiscoveryCandidate[]
  onConnected?: (service: string) => void
}) {
  const { toast } = useToast()
  const saveCred = useSaveCredential()
  const [connecting, setConnecting] = React.useState<string | null>(null)
  const [connected, setConnected] = React.useState<Set<string>>(new Set())
  const [values, setValues] = React.useState<Record<string, Record<string, string>>>({})

  const handleConnect = async (cand: ApiDiscoveryCandidate) => {
    const fields = values[cand.id] ?? {}
    const missing = cand.credentialFields.filter((f) => f.required && !fields[f.key]?.trim())
    if (missing.length) {
      toast({ title: 'Fill in the required fields', description: missing.map((m) => m.label).join(', '), variant: 'destructive' })
      return
    }
    setConnecting(cand.id)
    try {
      // Save each field as a credential (in a real app, one credential with multiple fields).
      // For the demo, save the first required field as the key.
      const firstField = cand.credentialFields[0]
      await saveCred.mutateAsync({
        service: cand.service.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        label: `${cand.service} — API key`,
        kind: firstField?.type === 'oauth' ? 'oauth' : firstField?.type === 'mcp_token' ? 'mcp_token' : 'apikey',
        metaJson: JSON.stringify({ service: cand.service, specUrl: cand.specUrl, fields: cand.credentialFields.map((f) => f.key) }),
        agentProvisioned: true,
      })
      setConnected((s) => new Set(s).add(cand.id))
      toast({ title: `${cand.service} connected`, description: 'Saved to your vault. I can use it now.' })
      onConnected?.(cand.service)
    } catch (e) {
      toast({ title: 'Could not save', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setConnecting(null)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
        <Search className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">API research</span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {candidates.length} {candidates.length === 1 ? 'service' : 'services'} found
        </span>
      </div>
      <div className="divide-y divide-border/60">
        {candidates.map((cand) => {
          const isDone = connected.has(cand.id)
          return (
            <div key={cand.id} className="p-3">
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
                  <Plug className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{cand.service}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">
                      {cand.kind}
                    </span>
                    {isDone && (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-500">
                        <Check className="h-2.5 w-2.5" /> Connected
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{cand.description}</p>
                  {cand.specUrl && (
                    <code className="mt-1 block truncate font-mono text-[10px] text-muted-foreground/70">{cand.specUrl}</code>
                  )}
                  {/* Tools discovered */}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {cand.tools.map((t) => (
                      <code key={t.id} className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {t.id}
                      </code>
                    ))}
                  </div>

                  {/* Credential input fields */}
                  {!isDone && cand.credentialFields.length > 0 && (
                    <div className="mt-2.5 space-y-1.5">
                      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        <KeyRound className="h-2.5 w-2.5" />
                        Connect — enter credentials
                      </div>
                      {cand.credentialFields.map((f) => (
                        <div key={f.key}>
                          <label className="mb-0.5 block text-[10px] text-muted-foreground">
                            {f.label} {f.required && <span className="text-destructive">*</span>}
                          </label>
                          <Input
                            type="password"
                            placeholder={f.placeholder}
                            value={values[cand.id]?.[f.key] ?? ''}
                            onChange={(e) =>
                              setValues((v) => ({
                                ...v,
                                [cand.id]: { ...v[cand.id], [f.key]: e.target.value },
                              }))
                            }
                            className="h-7 text-xs"
                          />
                        </div>
                      ))}
                      <Button
                        size="sm"
                        className="mt-1 h-7 text-xs"
                        disabled={connecting === cand.id}
                        onClick={() => handleConnect(cand)}
                      >
                        {connecting === cand.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Lock className="mr-1 h-3 w-3" />}
                        Save to vault
                      </Button>
                      <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Lock className="h-2.5 w-2.5" />
                        Stored encrypted. The agent retrieves it at runtime.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </motion.div>
  )
}

// ---------------- Suggestions (tailored empty-state) ----------------
export function SuggestionsList({
  suggestions,
  onPick,
}: {
  suggestions: NonNullable<ChatMessage['suggestions']>
  onPick: (prompt: string) => void
}) {
  return (
    <div className="space-y-1.5">
      {suggestions.map((s, i) => (
        <motion.button
          key={i}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          onClick={() => onPick(s.prompt)}
          className="group flex w-full items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
        >
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium">{s.title}</div>
            <div className="text-[11px] text-muted-foreground line-clamp-1">{s.prompt}</div>
            <div className="mt-0.5 text-[10px] italic text-muted-foreground/70">{s.reason}</div>
          </div>
        </motion.button>
      ))}
    </div>
  )
}

// ---------------- Research result card (web-search-sourced API discovery) ----------------
export function ResearchCard({ research, onAddCandidate }: {
  research: ResearchResult
  onAddCandidate?: (candidate: ApiDiscoveryCandidate) => void
}) {
  const [expanded, setExpanded] = React.useState(false)
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
        <Globe className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">Researched the web</span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {research.sources.length} sources · {research.candidates.length} {research.candidates.length === 1 ? 'API' : 'APIs'} found
        </span>
      </div>
      <div className="p-3">
        <p className="text-xs leading-relaxed text-foreground/90">{research.summary}</p>

        {research.candidates.length > 0 && (
          <div className="mt-2.5 space-y-1.5">
            {research.candidates.map((cand) => (
              <div key={cand.id} className="rounded-lg border border-border/60 bg-card/60 p-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted"><Plug className="h-3 w-3 text-muted-foreground" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium">{cand.service}</span>
                      <span className="rounded bg-muted px-1 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">{cand.kind}</span>
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">{cand.description}</div>
                  </div>
                  {onAddCandidate && (
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => onAddCandidate(cand)}>
                      <Plus className="mr-0.5 h-2.5 w-2.5" /> Add
                    </Button>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {cand.tools.map((t) => (
                    <code key={t.id} className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[10px] text-muted-foreground">{t.id}</code>
                  ))}
                </div>
                {cand.credentialFields.length > 0 && (
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <KeyRound className="h-2.5 w-2.5" /> Needs: {cand.credentialFields.map((f) => f.label).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {research.sources.length > 0 && (
          <div className="mt-2.5">
            <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground">
              <ExternalLink className="h-2.5 w-2.5" /> Sources ({research.sources.length})
            </button>
            {expanded && (
              <div className="mt-1.5 space-y-1">
                {research.sources.map((s, i) => (
                  <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="block truncate rounded px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/5">
                    {s.title} — <span className="text-muted-foreground">{new URL(s.url).host}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ---------------- Script analysis card ----------------
export function ScriptAnalysisCard({ analysis, onAddStep }: {
  analysis: ScriptAnalysis
  onAddStep?: (step: ScriptAnalysis['proposedStep']) => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
        <FileCode2 className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">Script analyzed</span>
        <span className="ml-auto rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{analysis.language}</span>
      </div>
      <div className="p-3 space-y-2.5">
        <p className="text-xs leading-relaxed text-foreground/90">{analysis.summary}</p>

        {analysis.inferredCalls.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Inferred API calls</div>
            {analysis.inferredCalls.map((call, i) => (
              <div key={i} className="rounded-lg border border-border/60 bg-card/60 p-2">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">{call.method}</span>
                  <code className="flex-1 truncate font-mono text-[11px]">{call.url}</code>
                  {call.authType && call.authType !== 'none' && (
                    <span className="rounded bg-muted px-1 py-0.5 font-mono text-[9px] text-muted-foreground">{call.authType}</span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{call.description}</div>
                {call.bodyShape && <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">body: {call.bodyShape}</div>}
              </div>
            ))}
          </div>
        )}

        {analysis.proposedStep && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5">
            <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-primary">
              <Code2 className="h-3 w-3" /> Proposed workflow step
            </div>
            <div className="mt-1 text-xs font-medium">{analysis.proposedStep.label}</div>
            {analysis.proposedStep.http && (
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="rounded bg-primary/15 px-1 py-0.5 font-mono text-[10px] text-primary">{analysis.proposedStep.http.method}</span>
                <code className="truncate font-mono text-[10px] text-muted-foreground">{analysis.proposedStep.http.url}</code>
              </div>
            )}
            {onAddStep && (
              <Button size="sm" className="mt-2 h-6 text-[11px]" onClick={() => onAddStep(analysis.proposedStep)}>
                <Plus className="mr-1 h-3 w-3" /> Add as a step
              </Button>
            )}
          </div>
        )}

        {analysis.proposedIntegration && (
          <div className="rounded-lg border border-border/60 bg-card/40 p-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Proposed integration</div>
            <div className="mt-0.5 text-xs font-medium">{analysis.proposedIntegration.name}</div>
            <div className="text-[11px] text-muted-foreground">{analysis.proposedIntegration.description}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {analysis.proposedIntegration.tools.map((t) => (
                <code key={t.id} className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[10px] text-muted-foreground">{t.id}</code>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}
