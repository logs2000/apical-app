import Link from "next/link";
import { ApicalMark } from "@/components/apical/logo";
import { ArrowRight } from "lucide-react";

type Mode = "signin" | "signup";

export function DesktopAuthForm({
  mode,
  error,
  isDev,
}: {
  mode: Mode;
  error?: string;
  isDev: boolean;
}) {
  const isSignup = mode === "signup";

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-[360px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <ApicalMark className="h-11" withGlow />
          <h1 className="mt-4 text-[22px] font-semibold tracking-tight">
            {isSignup ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isSignup
              ? "Set up Apical to start running agents."
              : "Sign in to pick up where you left off."}
          </p>
        </div>

        {/* Mode toggle — plain links, no JS */}
        <div className="mb-6 grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1">
          <Link
            href="/desktop"
            className={`rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors ${
              !isSignup
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Sign in
          </Link>
          <Link
            href="/desktop?mode=signup"
            className={`rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors ${
              isSignup
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Create account
          </Link>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {decodeURIComponent(error.replace(/\+/g, " "))}
          </div>
        )}

        {/* Native form — works without JavaScript */}
        <form method="POST" action="/api/auth/desktop-login" className="space-y-3">
          <input type="hidden" name="mode" value={mode} />

          {isSignup && (
            <Field label="Name" htmlFor="name">
              <input
                id="name"
                name="name"
                type="text"
                placeholder="Jordan Doe"
                autoComplete="name"
                className={inputClass}
              />
            </Field>
          )}

          <Field label="Email" htmlFor="email">
            <input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
              autoFocus
              className={inputClass}
            />
          </Field>

          <Field label="Password" htmlFor="password">
            <input
              id="password"
              name="password"
              type="password"
              placeholder={isSignup ? "Create a password" : "••••••••"}
              autoComplete={isSignup ? "new-password" : "current-password"}
              required
              className={inputClass}
            />
          </Field>

          <button type="submit" className={submitClass}>
            {isSignup ? "Create account" : "Sign in"}
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </button>
        </form>

        {isDev && (
          <a
            href="/api/auth/desktop-dev"
            className="mt-6 flex w-full items-center justify-center text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Skip and continue in dev mode
          </a>
        )}
      </div>
    </div>
  );
}

const inputClass =
  "flex h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

const submitClass =
  "inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90";

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5 text-left">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
