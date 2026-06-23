"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { signIn as nextAuthSignIn, signOut as nextAuthSignOut } from "next-auth/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, LogOut, Rocket, ArrowRight } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthUser {
  email: string;
  name: string;
  image?: string | null;
}

export type AuthMode = "signin" | "signup";

interface AuthContextValue {
  /** The currently signed-in user, or null. */
  user: AuthUser | null;
  /** True while we're checking the session on first mount. */
  loading: boolean;
  /** Open the auth dialog in the given mode. */
  openAuth: (mode?: AuthMode) => void;
  /** Close the auth dialog. */
  closeAuth: () => void;
  /** Sign the current user out. */
  signOut: () => Promise<void>;
  /**
   * "Launch" the web app — if the user is signed in (or in demo mode) this
   * opens the app; otherwise it opens the sign-in dialog first.
   */
  launch: () => void;
  /** Whether we're running in demo mode (stored in sessionStorage). */
  isDemo: boolean;
  /** Enter demo mode (no auth required). */
  enterDemo: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

const DEMO_KEY = "apical_demo_mode";

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<AuthMode>("signin");
  const [isDemo, setIsDemo] = useState(false);

  // ---- Check session on mount ----
  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      try {
        const res = await fetch("/api/auth/session");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (data?.user?.email) {
          setUser({
            email: data.user.email,
            name: data.user.name ?? data.user.email.split("@")[0],
            image: data.user.image ?? null,
          });
        }
      } catch {
        // Session check failed — stay logged out.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    // Also check demo mode from sessionStorage
    try {
      if (typeof window !== "undefined" && sessionStorage.getItem(DEMO_KEY) === "true") {
        setIsDemo(true);
      }
    } catch {
      // Ignore
    }

    checkSession();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- openAuth / closeAuth ----
  const openAuth = useCallback((mode: AuthMode = "signin") => {
    setDialogMode(mode);
    setDialogOpen(true);
  }, []);

  const closeAuth = useCallback(() => {
    setDialogOpen(false);
  }, []);

  // ---- signOut ----
  const handleSignOut = useCallback(async () => {
    try {
      await nextAuthSignOut({ redirect: false });
    } catch {
      // NextAuth sign-out can fail if there's no session — that's fine.
    }
    setUser(null);
    setIsDemo(false);
    try {
      sessionStorage.removeItem(DEMO_KEY);
    } catch {
      // Ignore
    }
  }, []);

  // ---- enterDemo ----
  const enterDemo = useCallback(() => {
    setIsDemo(true);
    try {
      sessionStorage.setItem(DEMO_KEY, "true");
    } catch {
      // Ignore
    }
  }, []);

  // ---- launch ----
  // Opens the in-page FullscreenApp overlay (mounted on the landing page).
  // FullscreenApp listens for the `apical:launch` custom event and also checks
  // sessionStorage("apical_landing_seen"). We trigger both so it works whether
  // or not FullscreenApp has mounted its listener yet.
  const launch = useCallback(() => {
    if (user || isDemo) {
      // Already authenticated or in demo mode — open the in-page app overlay.
      try {
        sessionStorage.setItem("apical_landing_seen", "1");
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new Event("apical:launch"));
    } else {
      // Not authenticated — show the sign-in dialog.
      openAuth("signin");
    }
  }, [user, isDemo, openAuth]);

  // ---- Context value ----
  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      openAuth,
      closeAuth,
      signOut: handleSignOut,
      launch,
      isDemo,
      enterDemo,
    }),
    [user, loading, openAuth, closeAuth, handleSignOut, launch, isDemo, enterDemo],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      <AuthDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        onModeChange={setDialogMode}
        onSuccess={(u) => {
          setUser(u);
          setDialogOpen(false);
        }}
      />
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// useAuth hook
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an <AuthProvider>");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// AuthDialog
// ---------------------------------------------------------------------------

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onSuccess: (user: AuthUser) => void;
}

function AuthDialog({ open, onOpenChange, mode, onModeChange, onSuccess }: AuthDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] p-0 overflow-hidden">
        <div className="bg-gradient-to-b from-emerald-600 to-emerald-700 px-6 pt-8 pb-6 text-white">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-white tracking-tight">
              Welcome to Apical
            </DialogTitle>
            <DialogDescription className="text-emerald-100 mt-1">
              Sign in to your account or create a new one to get started.
            </DialogDescription>
          </DialogHeader>
        </div>

        <Tabs
          value={mode}
          onValueChange={(v) => onModeChange(v as AuthMode)}
          className="px-6 pb-6 pt-4"
        >
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="signin">Sign In</TabsTrigger>
            <TabsTrigger value="signup">Create Account</TabsTrigger>
          </TabsList>

          <TabsContent value="signin" className="mt-5">
            <SignInForm onSuccess={onSuccess} onSwitchToSignUp={() => onModeChange("signup")} />
          </TabsContent>

          <TabsContent value="signup" className="mt-5">
            <SignUpForm onSuccess={onSuccess} onSwitchToSignIn={() => onModeChange("signin")} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sign In Form
// ---------------------------------------------------------------------------

interface SignInFormProps {
  onSuccess: (user: AuthUser) => void;
  onSwitchToSignUp: () => void;
}

function SignInForm({ onSuccess, onSwitchToSignUp }: SignInFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");

      if (!email.trim()) {
        setError("Please enter your email.");
        return;
      }
      if (!password) {
        setError("Please enter your password.");
        return;
      }

      setSubmitting(true);
      try {
        const result = await nextAuthSignIn("credentials", {
          email: email.trim().toLowerCase(),
          password,
          redirect: false,
        });

        if (result?.error) {
          setError("Invalid email or password. Please try again.");
          return;
        }

        // Fetch the updated session to get the user info.
        const res = await fetch("/api/auth/session");
        const data = await res.json();
        if (data?.user?.email) {
          onSuccess({
            email: data.user.email,
            name: data.user.name ?? data.user.email.split("@")[0],
            image: data.user.image ?? null,
          });
        } else {
          setError("Something went wrong. Please try again.");
        }
      } catch {
        setError("An unexpected error occurred. Please try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [email, password, onSuccess],
  );

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 dark:bg-red-950/50 dark:border-red-900 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="signin-email">Email</Label>
        <Input
          id="signin-email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          className="h-10"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="signin-password">Password</Label>
        <Input
          id="signin-password"
          type="password"
          placeholder="Enter your password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          className="h-10"
        />
      </div>

      <Button
        type="submit"
        className="w-full h-10 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
        disabled={submitting}
      >
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Signing in...
          </>
        ) : (
          <>
            Sign In
            <ArrowRight className="size-4" />
          </>
        )}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <button
          type="button"
          onClick={onSwitchToSignUp}
          className="text-emerald-600 hover:text-emerald-700 font-medium underline-offset-4 hover:underline"
        >
          Create one
        </button>
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Sign Up Form
// ---------------------------------------------------------------------------

interface SignUpFormProps {
  onSuccess: (user: AuthUser) => void;
  onSwitchToSignIn: () => void;
}

function SignUpForm({ onSuccess, onSwitchToSignIn }: SignUpFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");

      const trimmedName = name.trim();
      const trimmedEmail = email.trim().toLowerCase();

      if (!trimmedName) {
        setError("Please enter your name.");
        return;
      }
      if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        setError("Please enter a valid email address.");
        return;
      }
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }

      setSubmitting(true);
      try {
        // Step 1: Create the account
        const registerRes = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmedName, email: trimmedEmail, password }),
        });

        const registerData = await registerRes.json();

        if (!registerRes.ok) {
          setError(registerData.error || "Could not create account. Please try again.");
          return;
        }

        // Step 2: Sign in with the newly created credentials
        const result = await nextAuthSignIn("credentials", {
          email: trimmedEmail,
          password,
          redirect: false,
        });

        if (result?.error) {
          // Account was created but auto sign-in failed — switch to sign in.
          setError("Account created! Please sign in with your credentials.");
          onSwitchToSignIn();
          return;
        }

        // Step 3: Fetch session to confirm and get user info
        const sessionRes = await fetch("/api/auth/session");
        const sessionData = await sessionRes.json();
        if (sessionData?.user?.email) {
          onSuccess({
            email: sessionData.user.email,
            name: sessionData.user.name ?? sessionData.user.email.split("@")[0],
            image: sessionData.user.image ?? null,
          });
        } else {
          onSuccess({ email: trimmedEmail, name: trimmedName });
        }
      } catch {
        setError("An unexpected error occurred. Please try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [name, email, password, onSuccess, onSwitchToSignIn],
  );

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 dark:bg-red-950/50 dark:border-red-900 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="signup-name">Full Name</Label>
        <Input
          id="signup-name"
          type="text"
          placeholder="Jane Smith"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={submitting}
          className="h-10"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="signup-email">Email</Label>
        <Input
          id="signup-email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          className="h-10"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="signup-password">Password</Label>
        <Input
          id="signup-password"
          type="password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          className="h-10"
        />
      </div>

      <Button
        type="submit"
        className="w-full h-10 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
        disabled={submitting}
      >
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Creating account...
          </>
        ) : (
          <>
            Create Account
            <Rocket className="size-4" />
          </>
        )}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <button
          type="button"
          onClick={onSwitchToSignIn}
          className="text-emerald-600 hover:text-emerald-700 font-medium underline-offset-4 hover:underline"
        >
          Sign in
        </button>
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Convenience components for use in the landing page
// ---------------------------------------------------------------------------

/**
 * A pre-built sign-in button that opens the auth dialog.
 */
export function SignInButton({ className }: { className?: string }) {
  const { openAuth } = useAuth();
  return (
    <Button
      variant="ghost"
      onClick={() => openAuth("signin")}
      className={className}
    >
      <LogOut className="size-4 mr-1.5 rotate-180" />
      Sign In
    </Button>
  );
}

/**
 * A pre-built sign-up button that opens the auth dialog in signup mode.
 */
export function SignUpButton({ className }: { className?: string }) {
  const { openAuth } = useAuth();
  return (
    <Button
      onClick={() => openAuth("signup")}
      className={`bg-emerald-600 hover:bg-emerald-700 text-white font-semibold ${className ?? ""}`}
    >
      Get Started
      <ArrowRight className="size-4" />
    </Button>
  );
}

/**
 * A "Launch App" button — opens the web app if authenticated, otherwise
 * prompts sign-in.
 */
export function LaunchButton({ className }: { className?: string }) {
  const { launch, user, isDemo, loading } = useAuth();

  if (loading) {
    return (
      <Button disabled className={className}>
        <Loader2 className="size-4 animate-spin" />
        Loading...
      </Button>
    );
  }

  return (
    <Button
      onClick={launch}
      className={`bg-emerald-600 hover:bg-emerald-700 text-white font-semibold ${className ?? ""}`}
    >
      <Rocket className="size-4" />
      {user || isDemo ? "Open the Web App" : "Get Started Free"}
    </Button>
  );
}

/**
 * A user avatar / menu chip shown when the user is signed in, or a
 * sign-in button when they&apos;re not.
 */
export function UserNav({ className }: { className?: string }) {
  const { user, isDemo, openAuth, signOut, enterDemo, loading } = useAuth();

  if (loading) {
    return (
      <div className={`flex items-center gap-2 ${className ?? ""}`}>
        <div className="size-8 rounded-full bg-muted animate-pulse" />
      </div>
    );
  }

  if (user) {
    return (
      <div className={`flex items-center gap-3 ${className ?? ""}`}>
        <div className="flex items-center gap-2 rounded-full bg-emerald-50 dark:bg-emerald-950/40 pl-1 pr-3 py-1">
          <div className="flex size-7 items-center justify-center rounded-full bg-emerald-600 text-white text-xs font-bold">
            {(user.name || user.email)[0].toUpperCase()}
          </div>
          <span className="text-sm font-medium text-emerald-900 dark:text-emerald-100 max-w-[140px] truncate">
            {user.name || user.email}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => signOut()}
          className="text-muted-foreground hover:text-foreground"
        >
          <LogOut className="size-4" />
        </Button>
      </div>
    );
  }

  if (isDemo) {
    return (
      <div className={`flex items-center gap-2 ${className ?? ""}`}>
        <span className="text-sm text-muted-foreground">Demo Mode</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => signOut()}
          className="text-sm"
        >
          Exit Demo
        </Button>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => openAuth("signin")}
        className="text-muted-foreground hover:text-foreground"
      >
        Sign In
      </Button>
      <Button
        size="sm"
        onClick={() => openAuth("signup")}
        className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
      >
        Get Started
      </Button>
    </div>
  );
}
