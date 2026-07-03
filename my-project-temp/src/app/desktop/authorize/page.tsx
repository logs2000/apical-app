'use client'

// Browser side of the desktop device-authorization login. The desktop app
// opens this page with ?code=XXXX-XXXX; the signed-in user confirms the code
// and we bind a DesktopSession to their account. The desktop's poll then
// picks up the session token.

import * as React from 'react'
import { Check, Laptop, Loader2, ShieldAlert, X } from 'lucide-react'

import { ApicalMark } from '@/components/apical/logo'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

interface DeviceInfo {
  userCode: string
  label: string
  platform: string | null
  appVersion: string | null
  expiresAt: string
}

type Phase = 'loading' | 'confirm' | 'approved' | 'denied' | 'error'

export default function DesktopAuthorizePage() {
  const [phase, setPhase] = React.useState<Phase>('loading')
  const [device, setDevice] = React.useState<DeviceInfo | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  const code =
    typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('code') ?? '').trim().toUpperCase()
      : ''

  React.useEffect(() => {
    if (!code) {
      setError('Missing code. Restart the login from your desktop app.')
      setPhase('error')
      return
    }
    fetch(`/api/auth/device/approve?code=${encodeURIComponent(code)}`)
      .then(async (res) => {
        if (res.status === 401) {
          const next = `/desktop/authorize?code=${encodeURIComponent(code)}`
          window.location.assign(`/login?next=${encodeURIComponent(next)}`)
          return
        }
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Code not found.')
        setDevice(data as DeviceInfo)
        setPhase('confirm')
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Something went wrong.')
        setPhase('error')
      })
  }, [code])

  async function decide(approve: boolean) {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/device/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userCode: code, approve }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to submit.')
      setPhase(approve ? 'approved' : 'denied')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <ApicalMark className="mb-2 h-8" />
          <CardTitle className="text-lg">Connect your desktop</CardTitle>
          <CardDescription>
            {phase === 'confirm'
              ? 'A desktop app is asking to sign in to your Apical account.'
              : phase === 'approved'
                ? 'Desktop connected.'
                : phase === 'denied'
                  ? 'Request denied.'
                  : phase === 'error'
                    ? 'This request can\u2019t be completed.'
                    : 'Checking the code\u2026'}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {phase === 'loading' && (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {phase === 'confirm' && device && (
            <>
              <div className="rounded-lg border border-border bg-muted/40 p-4">
                <div className="flex items-center gap-3">
                  <Laptop className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{device.label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {[device.platform, device.appVersion && `v${device.appVersion}`]
                        .filter(Boolean)
                        .join(' · ') || 'Desktop app'}
                    </div>
                  </div>
                </div>
              </div>
              <div className="text-center">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Confirm this code matches your desktop
                </div>
                <div className="mt-1 font-mono text-2xl font-semibold tracking-widest">
                  {device.userCode}
                </div>
              </div>
              <p className="text-center text-[11px] text-muted-foreground">
                Approving lets this desktop run agents, read and write files, and use
                credentials in your account. Only approve codes you started yourself.
              </p>
            </>
          )}

          {phase === 'approved' && (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <Check className="h-8 w-8 text-foreground" />
              <p className="text-sm">
                You can close this tab — your desktop app will finish connecting on its own.
              </p>
            </div>
          )}

          {phase === 'denied' && (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <X className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                The desktop app was not connected. You can close this tab.
              </p>
            </div>
          )}

          {(phase === 'error' || error) && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
        </CardContent>

        {phase === 'confirm' && (
          <CardFooter className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              disabled={submitting}
              onClick={() => decide(false)}
            >
              Deny
            </Button>
            <Button className="flex-1" disabled={submitting} onClick={() => decide(true)}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Approve'}
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  )
}
