"use client";

import * as React from "react";
import { useSession } from "@/lib/supabase/session-context";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ApicalMark } from "@/components/apical/logo";
import { ArrowRight, Loader2, Mail } from "lucide-react";

type Mode = "signin" | "signup";

type AuthDialogState = {
  open: boolean;
  mode: Mode;
  openAuth: (mode?: Mode) => void;
  close: () => void;
  /** Launch the web app — opens auth if not signed in, otherwise opens the app */
  launch: () => void;
  /** The signed-in user (null until they sign in or dev-skip on desktop) */
  user: { email: string; name: string } | null;
  /** Desktop dev skip / immediate entry before session cookie syncs */
  completeDesktopAuth: (user: { email: string; name: string }) => void;
  signOut: () => void;
  /** When true, the demo app should render fullscreen (over the landing) */
  appOpen: boolean;
  closeApp: () => void;
};

const Ctx = React.createContext<AuthDialogState | null>(null);

export function useAuth() {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("useAuth must be used inside <AuthProvider>");
  return c;
}

export function AuthProvider({
  children,
  variant = "landing",
}: {
  children: React.ReactNode;
  /**
   * landing = marketing site at "/" (auth dialog + routes into the app);
   * web = the standalone web app at "/app" (already authenticated);
   * desktop = native app entry (no home page)
   */
  variant?: "landing" | "desktop" | "web";
}) {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<Mode>("signin");
  const [user, setUser] = React.useState<{ email: string; name: string } | null>(null);
  const [bypassUser, setBypassUser] = React.useState<{ email: string; name: string } | null>(null);
  const [appOpen, setAppOpen] = React.useState(variant === "web");
  const isDesktop = variant === "desktop";
  const isWeb = variant === "web";
  const isLanding = variant === "landing";
  const effectiveUser = user ?? bypassUser;

  // Sync with the NextAuth session. This fixes the "sometimes logging in
  // doesn't actually take me in" bug: after a successful signIn(), the
  // session is set in the cookie, but the local `user` state was only set
  // by the onSuccess callback. On a page reload, `user` reset to null even
  // though the session was still valid. Now we derive `user` from the
  // session, so it persists across reloads.
  const { data: session, status } = useSession();
  React.useEffect(() => {
    if (status === "authenticated" && session?.user) {
      const email = session.user.email ?? "";
      const name = session.user.name ?? email.split("@")[0];
      setUser({ email, name });
    } else if (status === "unauthenticated") {
      setUser(null);
    }
  }, [status, session]);

  const openAuth = React.useCallback((m: Mode = "signin") => {
    setMode(m);
    setOpen(true);
  }, []);

  const close = React.useCallback(() => setOpen(false), []);

  const launch = React.useCallback(() => {
    if (user || status === "authenticated") {
      // Landing: navigate to the standalone app route so refreshes don't
      // reload the marketing page. A real navigation is used (instead of the
      // client router) so it works even if the marketing page hasn't fully
      // hydrated. Other variants just toggle the overlay.
      if (isLanding) window.location.assign("/app");
      else setAppOpen(true);
    } else {
      setMode("signin");
      setOpen(true);
    }
  }, [user, status, isLanding]);

  const signOut = React.useCallback(() => {
    setUser(null);
    setBypassUser(null);
    setAppOpen(false);
    // Clear the Supabase session cookie so the useEffect above doesn't re-set
    // the user on the next render.
    const supabase = createClient();
    if (supabase) void supabase.auth.signOut();
    // From the standalone app route, return to the marketing site.
    if (isWeb) window.location.assign("/");
  }, [isWeb]);

  const closeApp = React.useCallback(() => {
    // On the standalone app route there's no overlay to close — go home.
    if (isWeb) window.location.assign("/");
    else setAppOpen(false);
  }, [isWeb]);

  const completeDesktopAuth = React.useCallback(
    (u: { email: string; name: string }) => {
      setBypassUser(u);
      setOpen(false);
    },
    [],
  );

  const completeAuth = React.useCallback(
    (u: { email: string; name: string }) => {
      setUser(u);
      setOpen(false);
      // After signing in from the marketing site, go straight to the app route.
      if (isLanding) window.location.assign("/app");
      else if (!isDesktop) setAppOpen(true);
    },
    [isLanding, isDesktop],
  );

  const value = React.useMemo<AuthDialogState>(
    () => ({
      open,
      mode,
      openAuth,
      close,
      launch,
      user: effectiveUser,
      completeDesktopAuth,
      signOut,
      appOpen,
      closeApp,
    }),
    [open, mode, openAuth, close, launch, effectiveUser, completeDesktopAuth, signOut, appOpen, closeApp],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {isLanding && (
        <AuthDialog
          open={open}
          mode={mode}
          onOpenChange={setOpen}
          onSwitchMode={setMode}
          onSuccess={completeAuth}
        />
      )}
    </Ctx.Provider>
  );
}

// ─── Dialog ─────────────────────────────────────────────────────────────────

function AuthDialog({
  open,
  mode,
  onOpenChange,
  onSwitchMode,
  onSuccess,
}: {
  open: boolean;
  mode: Mode;
  onOpenChange: (v: boolean) => void;
  onSwitchMode: (m: Mode) => void;
  onSuccess: (user: { email: string; name: string }) => void;
}) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const { toast } = useToast();

  const isSignup = mode === "signup";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    try {
      const supabase = createClient();
      if (!supabase) throw new Error("Auth is not configured.");

      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name: name || undefined },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=/app`,
          },
        });
        if (error) throw new Error(error.message || "Registration failed");
        // Email confirmation enabled → no session yet.
        if (!data.session) {
          toast({
            title: "Check your email",
            description: "Confirm your address to finish signing up.",
          });
          setEmail("");
          setPassword("");
          setName("");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw new Error(error.message || "Invalid credentials");
      }

      const derivedName = isSignup ? name || email.split("@")[0] : email.split("@")[0];
      toast({
        title: isSignup ? "Account created" : "Welcome back",
        description: `Signed in as ${email}`,
      });
      onSuccess({ email, name: derivedName });
      setEmail("");
      setPassword("");
      setName("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      toast({ title: "Sign in failed", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const continueWithGoogle = async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      if (!supabase) throw new Error("Auth is not configured.");
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback?next=/app` },
      });
      if (error) throw new Error(error.message);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Google sign in failed";
      toast({ title: "Google sign in failed", description: msg, variant: "destructive" });
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <ApicalMark className="h-6 w-6" />
            <span className="text-sm font-semibold tracking-tight">Apical</span>
          </div>
          <DialogTitle>{isSignup ? "Create your account" : "Sign in to Apical"}</DialogTitle>
          <DialogDescription>
            {isSignup
              ? "Free to start. No credit card. Runs on your computer."
              : "Pick up where you left off. Your agents are waiting."}
          </DialogDescription>
        </DialogHeader>

        {/* Google continue */}
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={continueWithGoogle}
          disabled={loading}
        >
          <GoogleIcon className="h-4 w-4" />
          Continue with Google
        </Button>

        <div className="relative my-1">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-[10px] uppercase tracking-wider">
            <span className="bg-background px-2 text-muted-foreground">or</span>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3">
          {isSignup && (
            <div className="space-y-1.5">
              <Label htmlFor="auth-name" className="text-xs">
                Name
              </Label>
              <Input
                id="auth-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jordan Doe"
                className="h-9 text-sm"
                autoComplete="name"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="auth-email" className="text-xs">
              Email
            </Label>
            <Input
              id="auth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="h-9 text-sm"
              autoComplete="email"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="auth-password" className="text-xs">
              Password
            </Label>
            <Input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="h-9 text-sm"
              autoComplete={isSignup ? "new-password" : "current-password"}
              required
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                {isSignup ? "Create account" : "Sign in"}
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </>
            )}
          </Button>
        </form>

        <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
          <Mail className="h-3 w-3" />
          {isSignup ? "Already have an account?" : "New to Apical?"}
          <button
            type="button"
            className="font-medium text-foreground hover:underline"
            onClick={() => onSwitchMode(isSignup ? "signin" : "signup")}
          >
            {isSignup ? "Sign in" : "Create one"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}
