'use client'

import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, ArrowRight, Loader2, ShieldCheck } from 'lucide-react'

import { ApicalMark, ApicalName } from '@/components/apical/logo'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'

export default function ResetPasswordPage() {
  return (
    <React.Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>}>
      <ResetPasswordForm />
    </React.Suspense>
  )
}

function ResetPasswordForm() {
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const queryToken = searchParams.get('token') || ''

  const [token, setToken] = React.useState(queryToken)
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [done, setDone] = React.useState(false)

  // If the query param shows up after first paint (e.g. on slow hydration),
  // sync it in. `token` is intentionally omitted from deps so we don't
  // overwrite user input that has diverged from the URL.
  React.useEffect(() => {
    if (queryToken && !token) setToken(queryToken)
  }, [queryToken])

  const passwordStrong = password.length >= 8
  const matches = password === confirm

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || !password) return
    if (!passwordStrong) {
      toast({
        title: 'Password too short',
        description: 'Use at least 8 characters.',
        variant: 'destructive',
      })
      return
    }
    if (!matches) {
      toast({
        title: 'Passwords don\'t match',
        description: 'Please re-enter the same password twice.',
        variant: 'destructive',
      })
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Reset failed')
      }
      setDone(true)
      toast({
        title: 'Password updated',
        description: 'You can now sign in with your new password.',
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Reset failed'
      toast({ title: 'Reset failed', description: msg, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-gradient-to-b from-brand/5 via-background to-background px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-accent blur-3xl"
      />
      <div className="relative w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <ApicalMark className="h-7 w-7" withGlow />
          <Link href="/">
            <ApicalName className="text-lg" withDot />
          </Link>
        </div>

        <Card className="border-border/60 shadow-lg">
          <CardHeader>
            <CardTitle className="text-xl">
              {done ? 'Password updated' : 'Set a new password'}
            </CardTitle>
            <CardDescription>
              {done
                ? 'Your password has been reset successfully.'
                : 'Choose a strong password you haven\'t used before.'}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {done ? (
              <div className="space-y-4 py-2">
                <div className="flex items-start gap-3 rounded-lg border border-border bg-muted p-4">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
                  <div className="text-sm">
                    <p className="font-medium">All set</p>
                    <p className="mt-1 text-muted-foreground">
                      Your password was updated. Sign in with your new credentials.
                    </p>
                  </div>
                </div>
                <Button asChild className="w-full">
                  <Link href="/login">
                    Continue to sign in
                    <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="reset-token" className="text-xs">
                    Reset token
                  </Label>
                  <Input
                    id="reset-token"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Paste the token from your email"
                    autoComplete="off"
                    required
                    autoFocus={!queryToken}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    The token was sent to your email (or shown in dev mode).
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reset-password" className="text-xs">
                    New password
                  </Label>
                  <Input
                    id="reset-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reset-confirm" className="text-xs">
                    Confirm new password
                  </Label>
                  <Input
                    id="reset-confirm"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Re-enter your new password"
                    autoComplete="new-password"
                    required
                  />
                  {confirm && !matches && (
                    <p className="text-[11px] text-destructive">
                      Passwords don&apos;t match.
                    </p>
                  )}
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      Update password
                      <ArrowRight className="ml-1.5 h-4 w-4" />
                    </>
                  )}
                </Button>
              </form>
            )}
          </CardContent>

          {!done && (
            <CardFooter className="justify-center">
              <Link
                href="/login"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-brand hover:underline"
              >
                <ArrowLeft className="h-3 w-3" />
                Back to sign in
              </Link>
            </CardFooter>
          )}
        </Card>
      </div>
    </div>
  )
}
