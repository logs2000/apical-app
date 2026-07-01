'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Lock } from 'lucide-react'

import { ApicalMark, ApicalName } from '@/components/apical/logo'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function GateForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next') || '/'

  const [passcode, setPasscode] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!passcode) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/gate/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Incorrect passcode.')
      }
      // Full navigation so middleware re-evaluates with the new cookie.
      window.location.assign(next)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-sm border-border/60 shadow-lg">
      <CardHeader className="text-center">
        <div className="mb-2 flex items-center justify-center gap-2">
          <ApicalMark className="h-7" withGlow />
          <ApicalName withDot />
        </div>
        <CardTitle className="flex items-center justify-center gap-2 text-lg">
          <Lock className="h-4 w-4" /> Private preview
        </CardTitle>
        <CardDescription>Enter the passcode to continue.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="passcode" className="text-xs">
              Passcode
            </Label>
            <Input
              id="passcode"
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="••••••••"
              autoFocus
              autoComplete="off"
            />
            {error && <p className="text-[11px] text-destructive">{error}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Enter'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

export default function GatePage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-gradient-to-b from-brand/5 via-background to-background px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-accent blur-3xl"
      />
      <React.Suspense fallback={null}>
        <GateForm />
      </React.Suspense>
    </div>
  )
}
