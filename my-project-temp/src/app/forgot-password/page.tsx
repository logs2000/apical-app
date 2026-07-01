'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Mail } from 'lucide-react'

import { ApicalMark, ApicalName } from '@/components/apical/logo'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'

export default function ForgotPasswordPage() {
  const { toast } = useToast()
  const [email, setEmail] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [sent, setSent] = React.useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Request failed')
      }
      setSent(true)
      // In dev, the API returns the token inline so you can paste it into the
      // reset page without email. We surface it via toast + dev message.
      if (data.devToken) {
        toast({
          title: 'Dev mode — reset token',
          description: `Token: ${data.devToken}`,
        })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Request failed'
      toast({ title: 'Could not request reset', description: msg, variant: 'destructive' })
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
            <ApicalName withDot />
          </Link>
        </div>

        <Card className="border-border/60 shadow-lg">
          <CardHeader>
            <CardTitle className="text-xl">Reset your password</CardTitle>
            <CardDescription>
              {sent
                ? 'If an account exists for that email, a reset link is on its way.'
                : 'Enter your email and we\'ll send you a link to reset your password.'}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {sent ? (
              <div className="space-y-4 py-2">
                <div className="flex items-start gap-3 rounded-lg border border-border bg-muted p-4">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
                  <div className="text-sm">
                    <p className="font-medium">Check your email</p>
                    <p className="mt-1 text-muted-foreground">
                      We sent a reset link to <span className="font-medium text-foreground">{email}</span> if
                      an account exists. The link expires in 1 hour.
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setSent(false)
                    setEmail('')
                  }}
                >
                  Use a different email
                </Button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="forgot-email" className="text-xs">
                    Email
                  </Label>
                  <Input
                    id="forgot-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                    autoFocus
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      Send reset link
                      <ArrowRight className="ml-1.5 h-4 w-4" />
                    </>
                  )}
                </Button>
              </form>
            )}
          </CardContent>

          <CardFooter className="justify-center">
            <Link
              href="/login"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-brand hover:underline"
            >
              <ArrowLeft className="h-3 w-3" />
              Back to sign in
            </Link>
          </CardFooter>
        </Card>

        <p className="mt-6 flex items-center justify-center gap-1 text-center text-[11px] text-muted-foreground">
          <Mail className="h-3 w-3" />
          Need help? Contact support@apic.al
        </p>
      </div>
    </div>
  )
}
