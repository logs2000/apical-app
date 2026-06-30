"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileText,
  FolderClosed,
  Bell,
  TrendingUp,
  Inbox,
  Receipt,
  Menu,
  Sparkles,
  Terminal,
  Users,
  Zap,
  ShieldCheck,
  Clock,
} from "lucide-react";
import { DesktopStage, DraggableWindow } from "@/components/landing/DesktopStage";
import { DemoAppShell } from "@/components/landing/DemoAppShell";
import { ApicalMark, ApicalMarkAnimated } from "@/components/apical/logo";
import { AuthProvider, useAuth } from "@/components/auth/AuthDialog";
import { IS_TAURI } from "@/lib/desktop/tauri-bridge";

// ─── OS detection (inlined so the page is self-contained) ──────────────────

type DetectedOS = "mac" | "windows" | "linux" | "other";

function detectOS(): DetectedOS {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac os x") || ua.includes("darwin")) return "mac";
  if (ua.includes("windows")) return "windows";
  if (ua.includes("linux")) return "linux";
  return "other";
}
function osLabel(os: DetectedOS): string {
  return os === "mac" ? "macOS" : os === "windows" ? "Windows" : os === "linux" ? "Linux" : "Pick platform";
}
function downloadButtonLabel(os: DetectedOS): string {
  return os === "other" ? "Download" : `Download for ${osLabel(os)}`;
}
function downloadUrl(os: DetectedOS): string {
  const base = "/downloads";
  if (os === "mac") return `${base}/apical-mac.tar.gz`;
  if (os === "windows") return `${base}/apical-windows.exe`;
  if (os === "linux") return `${base}/apical-linux.AppImage`;
  return `${base}/`;
}
function installCommandFor(os: DetectedOS): string {
  if (os === "mac") return "brew install --cask apical";
  if (os === "windows") return "winget install apical.apical";
  if (os === "linux") return "curl -fsSL https://apic.al/install.sh | sh";
  return "curl -fsSL https://apic.al/install.sh | sh";
}
function markLandingSeen() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem("apical_landing_seen", "1");
  } catch {
    /* ignore */
  }
}

// ─── Pricing plans (inlined) ───────────────────────────────────────────────

type Plan = {
  id: string;
  name: string;
  tagline: string;
  priceMonthly: number;
  priceYearly: number;
  featured?: boolean;
  features: string[];
};

const PLAN_LIST: Plan[] = [
  {
    id: "free",
    name: "Free",
    tagline: "For trying it out and small jobs.",
    priceMonthly: 0,
    priceYearly: 0,
    features: ["1 agent running at a time", "50 tasks / month", "Local-only model keys", "Community support"],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For people who actually want work done.",
    priceMonthly: 19,
    priceYearly: 190,
    featured: true,
    features: ["5 agents running at once", "Unlimited tasks", "Bring-your-own model keys", "Scheduled + recurring runs", "Email support"],
  },
  {
    id: "team",
    name: "Team",
    tagline: "For a small group handing off together.",
    priceMonthly: 49,
    priceYearly: 490,
    features: ["Everything in Pro", "5 seats included", "Shared folders + agents", "Audit log export", "Priority support"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "For org-wide deployments.",
    priceMonthly: 0,
    priceYearly: 0,
    features: ["Self-host or cloud", "SSO + SAML", "Custom DPA", "Dedicated success manager", "Volume pricing"],
  },
];

// ─── Page ───────────────────────────────────────────────────────────────────

function HomeContent() {
  const [os, setOs] = React.useState<DetectedOS>("other");
  const [mounted, setMounted] = React.useState(false);
  const prefersReducedMotion = useReducedMotion();
  const { launch } = useAuth();

  React.useEffect(() => {
    setOs(detectOS());
    setMounted(true);
  }, []);

  // Desktop shell must never stay on the marketing home page (needs JS to run).
  React.useEffect(() => {
    if (IS_TAURI) {
      window.location.replace("/api/auth/desktop-ui");
    }
  }, []);

  if (IS_TAURI) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <span className="text-sm text-muted-foreground">Opening Apical…</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground" suppressHydrationWarning>
      <Nav os={mounted ? os : "other"} onLaunch={launch} />
      <main className="flex-1">
        <Hero os={mounted ? os : "other"} onLaunch={launch} reduced={prefersReducedMotion} />
        <SocialProof />
        <HowItWorks reduced={prefersReducedMotion} />
        <UseCases reduced={prefersReducedMotion} />
        <Pricing os={mounted ? os : "other"} onLaunch={launch} />
        <ForDevelopers />
        <FinalCTA os={mounted ? os : "other"} onLaunch={launch} />
      </main>
      <Footer />
    </div>
  );
}

export default function Home() {
  return (
    <AuthProvider>
      <HomeContent />
    </AuthProvider>
  );
}

// ─── Nav ────────────────────────────────────────────────────────────────────

function Nav({ os, onLaunch }: { os: DetectedOS; onLaunch: () => void }) {
  const [open, setOpen] = React.useState(false);
  const { user, openAuth, signOut } = useAuth();
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-lg">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 md:px-6">
        <ApicalMark className="h-6 w-6" />
        <span className="text-sm font-semibold tracking-tight">Apical</span>

        <nav className="ml-6 hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <a href="#how" className="transition-colors hover:text-foreground">How it works</a>
          <a href="#examples" className="transition-colors hover:text-foreground">Examples</a>
          <a href="#pricing" className="transition-colors hover:text-foreground">Pricing</a>
          <a href="#developers" className="transition-colors hover:text-foreground">Docs</a>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {user.email}
              </span>
              <Button variant="ghost" size="sm" onClick={onLaunch}>
                Open app
              </Button>
              <Button variant="ghost" size="sm" onClick={signOut}>
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="hidden sm:inline-flex"
                onClick={() => openAuth("signin")}
              >
                Sign in
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="hidden sm:inline-flex"
                onClick={() => openAuth("signup")}
              >
                Sign up
              </Button>
            </>
          )}
          <DownloadButton os={os} variant="default" size="sm" />
          <div className="md:hidden">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72">
                <div className="mt-6 flex flex-col gap-4 px-4">
                  <a href="#how" onClick={() => setOpen(false)} className="text-sm font-medium">How it works</a>
                  <a href="#examples" onClick={() => setOpen(false)} className="text-sm font-medium">Examples</a>
                  <a href="#pricing" onClick={() => setOpen(false)} className="text-sm font-medium">Pricing</a>
                  <a href="#developers" onClick={() => setOpen(false)} className="text-sm font-medium">Docs</a>
                  <Button variant="outline" className="mt-2 w-full" onClick={() => { setOpen(false); onLaunch() }}>
                    Open the web app
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </header>
  );
}

// ─── Hero — with live preview replacing the static screenshot ───────────────

function Hero({
  os,
  onLaunch,
  reduced,
}: {
  os: DetectedOS;
  onLaunch: () => void;
  reduced: boolean | null;
}) {
  return (
    <section className="relative overflow-hidden">
      {/* Subtle background — soft green glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, oklch(0.96 0 0 / 0.8) 0%, transparent 70%)",
        }}
      />

      <div className="mx-auto max-w-4xl px-4 py-20 text-center md:py-24 md:px-6">
        <ApicalMarkAnimated className="mx-auto mb-8 aspect-[465/375] h-14 text-brand md:h-16" />

        <motion.div
          initial={reduced ? undefined : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          <Badge variant="outline" className="mb-6 gap-1.5 border-border/80 px-3 py-1 text-xs text-muted-foreground">
            <Sparkles className="h-3 w-3" /> AI agents that actually do the work
          </Badge>

          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl md:text-6xl">
            Consider it <span className="text-brand">Done.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground text-pretty md:text-xl">
            Tell Apical what needs doing. An AI agent figures out the steps,
            does the busywork, and hands you the result. You decide. It does.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <DownloadButton os={os} size="lg" className="w-full sm:w-auto" />
            <Button variant="outline" size="lg" onClick={onLaunch} className="w-full sm:w-auto">
              Open the web app <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            Free to start. No credit card. Runs on your computer.
          </p>
        </motion.div>

        {/* Live interactive preview (replaces the static screenshot) */}
        <motion.div
          initial={reduced ? undefined : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.6, ease: "easeOut" }}
          className="mx-auto mt-14 max-w-5xl"
        >
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Live preview — drag the window
            </span>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" /> interactive
            </span>
          </div>
          <DesktopStage>
            <DraggableWindow width={820} height={520}>
              <DemoAppShell />
            </DraggableWindow>
          </DesktopStage>
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            A live look at the app — Agents, Vault, and Data tabs. Type a job and watch
            it propose a workflow. Drag the title bar to move the window. Sign in for the full app.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

// ─── Social proof strip ─────────────────────────────────────────────────────

function SocialProof() {
  return (
    <section className="border-y border-border/50 bg-muted/30">
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
        <p className="text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Built for people who have too much to do
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-sm font-medium text-muted-foreground/80">
          <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Private by default</span>
          <span className="flex items-center gap-2"><Clock className="h-4 w-4" /> Works while you sleep</span>
          <span className="flex items-center gap-2"><Zap className="h-4 w-4" /> Learns your job</span>
          <span className="flex items-center gap-2"><Users className="h-4 w-4" /> For one person or a whole team</span>
        </div>
      </div>
    </section>
  );
}

// ─── How it works ───────────────────────────────────────────────────────────

function HowItWorks({ reduced }: { reduced: boolean | null }) {
  const steps = [
    {
      n: "01",
      title: "Describe the job",
      body: "Type it out like you're delegating to a smart assistant. \"Sort my scanned documents into client folders.\" \"Check my competitors' pricing every week.\" \"Remind me when a license is about to expire.\"",
    },
    {
      n: "02",
      title: "Approve the plan",
      body: "Apical's agent breaks the job into steps and shows you the plan. You approve. It starts working — and asks before doing anything risky.",
    },
    {
      n: "03",
      title: "It just runs",
      body: "The agent does the work, again and again, without you watching. It gets faster over time as it learns your patterns. You get the results — and your time back.",
    },
  ];

  return (
    <section id="how" className="scroll-mt-16">
      <div className="mx-auto max-w-4xl px-4 py-20 md:px-6 md:py-28">
        <div className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Less doing. <span className="text-brand">More deciding.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            You don&apos;t need to understand AI. You just need to know what you want done.
          </p>
        </div>

        <div className="mt-14 grid gap-8 md:grid-cols-3">
          {steps.map((s, i) => (
            <motion.div
              key={s.n}
              initial={reduced ? undefined : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ delay: i * 0.1, duration: 0.4 }}
              className="text-left"
            >
              <div className="text-sm font-mono text-brand">{s.n}</div>
              <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Use cases ──────────────────────────────────────────────────────────────

function UseCases({ reduced }: { reduced: boolean | null }) {
  const cases = [
    { icon: FileText, title: "Filing", body: "Sort scans, invoices, and documents into the right folders automatically." },
    { icon: TrendingUp, title: "Sales leads", body: "Find potential customers and keep your list fresh without lifting a finger." },
    { icon: Bell, title: "Reminders", body: "Never let a license, contract, or deadline expire again." },
    { icon: FolderClosed, title: "Competitor watch", body: "Know when a competitor changes their pricing or launches something new." },
    { icon: Inbox, title: "Inbox triage", body: "Every inbound email sorted, routed, and answered the right way." },
    { icon: Receipt, title: "Expenses", body: "Audit reports against your policy and flag the ones that need a look." },
  ];

  return (
    <section id="examples" className="scroll-mt-16 border-t border-border/50 bg-muted/20">
      <div className="mx-auto max-w-5xl px-4 py-20 md:px-6 md:py-28">
        <div className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
            What will you hand off?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Any repetitive task — Apical can run it.
          </p>
        </div>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cases.map((c, i) => {
            const Icon = c.icon;
            return (
              <motion.div
                key={c.title}
                initial={reduced ? undefined : { opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ delay: i * 0.06, duration: 0.35 }}
                className="rounded-lg border border-border/60 bg-card p-5"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-foreground">
                  <Icon className="h-4 w-4" />
                </div>
                <h3 className="mt-3 text-sm font-semibold">{c.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.body}</p>
              </motion.div>
            );
          })}
        </div>

        <p className="mt-10 text-center text-sm text-muted-foreground">
          That&apos;s just the start. If you can describe it, an agent can probably do it.
        </p>
      </div>
    </section>
  );
}

// ─── Pricing ────────────────────────────────────────────────────────────────

function Pricing({ os, onLaunch }: { os: DetectedOS; onLaunch: () => void }) {
  const [interval, setInterval] = React.useState<"monthly" | "yearly">("monthly");

  return (
    <section id="pricing" className="scroll-mt-16">
      <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
        <div className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Simple pricing
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Start free. Upgrade when it&apos;s doing real work for you.
          </p>
        </div>

        {/* Interval toggle */}
        <div className="mt-8 flex items-center justify-center">
          <div className="inline-flex items-center rounded-full border border-border bg-muted/40 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setInterval("monthly")}
              className={cn(
                "rounded-full px-4 py-1.5 font-medium transition-colors",
                interval === "monthly" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setInterval("yearly")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 font-medium transition-colors",
                interval === "yearly" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              Yearly
              <span className="rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold uppercase text-brand">
                2 mo free
              </span>
            </button>
          </div>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PLAN_LIST.map((plan, i) => {
            const featured = plan.featured;
            const isFree = plan.id === "free";
            const isEnterprise = plan.id === "enterprise";
            const price = computePrice(plan, interval);

            const cta = isFree
              ? "Get started"
              : isEnterprise
                ? "Contact sales"
                : "Choose";

            return (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.07, duration: 0.35 }}
                className={cn(
                  "relative flex flex-col rounded-xl border bg-card p-6",
                  featured
                    ? "border-foreground/20 shadow-md lg:-translate-y-1"
                    : "border-border hover:border-border/80",
                )}
              >
                {featured && (
                  <Badge className="absolute -top-2.5 left-6 gap-1 bg-primary text-primary-foreground">
                    <Sparkles className="h-3 w-3" /> Most popular
                  </Badge>
                )}

                <h3 className="text-base font-semibold">{plan.name}</h3>
                <p className="mt-1 min-h-[2.5rem] text-xs leading-relaxed text-muted-foreground">
                  {plan.tagline}
                </p>

                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-semibold tracking-tight">{price.display}</span>
                  {price.suffix && <span className="text-sm text-muted-foreground">{price.suffix}</span>}
                </div>
                <div className="mt-1 min-h-[1rem] text-[11px] text-muted-foreground">
                  {price.sub || "\u00A0"}
                </div>

                <div className="mt-5">
                  <Button
                    variant={featured ? "default" : "outline"}
                    className="w-full"
                    onClick={() => {
                      if (isFree) onLaunch();
                      else if (isEnterprise) {
                        window.location.href = "mailto:sales@apic.al?subject=Apical%20Enterprise";
                      } else {
                        // Demo: just navigate to the web app
                        onLaunch();
                      }
                    }}
                  >
                    {cta} <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Button>
                </div>

                <ul className="mt-6 space-y-2.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent text-foreground">
                        <Check className="h-2.5 w-2.5" />
                      </span>
                      <span className="leading-relaxed text-foreground/80">{f}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function computePrice(
  plan: Plan,
  interval: "monthly" | "yearly",
): { display: string; suffix?: string; sub?: string } {
  if (plan.id === "enterprise") return { display: "Custom", sub: "Volume pricing — talk to sales." };
  if (plan.id === "free") return { display: "$0", suffix: "/mo", sub: "Free forever. No credit card." };
  const perSeat = plan.id === "team" ? " /seat" : "";
  if (interval === "monthly") {
    return {
      display: `$${plan.priceMonthly}`,
      suffix: `/mo${perSeat}`,
      sub: plan.id === "team" ? "5 seats included." : "Billed monthly.",
    };
  }
  const perMonth = plan.priceYearly / 12;
  const monthsFree = 12 - Math.round(plan.priceYearly / plan.priceMonthly);
  return {
    display: `$${perMonth % 1 === 0 ? perMonth : perMonth.toFixed(2)}`,
    suffix: `/mo${perSeat}`,
    sub: `$${plan.priceYearly}/yr${perSeat} — ${monthsFree} months free`,
  };
}

// ─── For Developers ─────────────────────────────────────────────────────────

function ForDevelopers() {
  return (
    <section id="developers" className="scroll-mt-16 border-t border-border/50 bg-muted/20">
      <div className="mx-auto max-w-4xl px-4 py-16 md:px-6 md:py-20">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div className="max-w-xl">
            <h2 className="text-2xl font-semibold tracking-tight">
              For developers
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Apical speaks MCP. Wire it into your editor, call it from your
              code, or run agents headlessly. Bring your own model keys —
              OpenAI, Anthropic, Google, or local.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <Button variant="outline" asChild>
              <a href="#developers">
                Read the docs <ArrowRight className="ml-1.5 h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Final CTA ──────────────────────────────────────────────────────────────

function FinalCTA({ os, onLaunch }: { os: DetectedOS; onLaunch: () => void }) {
  return (
    <section className="border-t border-border/50">
      <div className="mx-auto max-w-3xl px-4 py-20 text-center md:px-6 md:py-28">
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
          What would you hand off today?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          Install Apical. Describe one job. Get your time back.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <DownloadButton os={os} size="lg" />
          <Button variant="ghost" size="lg" onClick={onLaunch}>
            Or try it in the browser
          </Button>
        </div>
      </div>
    </section>
  );
}

// ─── Footer ─────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-border/60 bg-background">
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row">
          <div className="flex items-center gap-2">
            <ApicalMark className="h-5 w-5" />
            <span className="text-sm font-semibold">Apical</span>
          </div>
          <div className="grid grid-cols-2 gap-8 text-xs sm:grid-cols-4">
            <div>
              <div className="mb-3 font-medium text-foreground">Product</div>
              <ul className="space-y-2 text-muted-foreground">
                <li><a href="#how" className="hover:text-foreground">How it works</a></li>
                <li><a href="#pricing" className="hover:text-foreground">Pricing</a></li>
                <li><a href="#examples" className="hover:text-foreground">Examples</a></li>
              </ul>
            </div>
            <div>
              <div className="mb-3 font-medium text-foreground">Resources</div>
              <ul className="space-y-2 text-muted-foreground">
                <li><a href="#developers" className="hover:text-foreground">Docs</a></li>
                <li><a href="#developers" className="hover:text-foreground">MCP + API</a></li>
              </ul>
            </div>
            <div>
              <div className="mb-3 font-medium text-foreground">Company</div>
              <ul className="space-y-2 text-muted-foreground">
                <li><a href="mailto:hello@apic.al" className="hover:text-foreground">Contact</a></li>
                <li><a href="mailto:sales@apic.al" className="hover:text-foreground">Sales</a></li>
              </ul>
            </div>
            <div>
              <div className="mb-3 font-medium text-foreground">Legal</div>
              <ul className="space-y-2 text-muted-foreground">
                <li><a href="#" className="hover:text-foreground">Privacy</a></li>
                <li><a href="#" className="hover:text-foreground">Terms</a></li>
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-10 border-t border-border/40 pt-6 text-center text-xs text-muted-foreground">
          Made for people with too much to do.
        </div>
      </div>
    </footer>
  );
}

// ─── Download button + dialog ───────────────────────────────────────────────

function DownloadButton({
  os: detectedOs,
  variant = "default",
  size = "default",
  className,
}: {
  os: DetectedOS;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg";
  className?: string;
}) {
  const initialOs: DetectedOS = detectedOs === "other" ? "mac" : detectedOs;
  const [selectedOs, setSelectedOs] = React.useState<DetectedOS>(initialOs);
  const [open, setOpen] = React.useState(false);
  const { toast } = useToast();

  React.useEffect(() => {
    if (detectedOs !== "other") setSelectedOs(detectedOs);
  }, [detectedOs]);

  const handleDownload = async (target: DetectedOS) => {
    try {
      const res = await fetch(downloadUrl(target), { method: "HEAD" });
      if (res.ok) {
        window.location.href = downloadUrl(target);
        return;
      }
      setSelectedOs(target);
      setOpen(true);
    } catch {
      setSelectedOs(target);
      setOpen(true);
    }
  };

  const handleClick = () => {
    void handleDownload(selectedOs);
  };

  const platforms: DetectedOS[] = ["mac", "windows", "linux"];

  return (
    <>
      <div className={cn("inline-flex", className?.includes("w-full") && "w-full")}>
        <Button
          variant={variant}
          size={size}
          onClick={handleClick}
          className={cn(className, "rounded-r-none")}
        >
          <Download className="mr-1.5 h-4 w-4" />
          {downloadButtonLabel(selectedOs)}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={variant}
              size={size}
              className="rounded-l-none border-l border-primary-foreground/20 px-2"
              aria-label="Choose download platform"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {platforms.map((p) => (
              <DropdownMenuItem
                key={p}
                className="gap-2"
                onClick={() => {
                  setSelectedOs(p);
                  void handleDownload(p);
                }}
              >
                <Check className={cn("h-3.5 w-3.5", selectedOs !== p && "invisible")} />
                {osLabel(p)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <DownloadDialog
        open={open}
        onOpenChange={setOpen}
        os={selectedOs}
        onCopied={() => toast({ title: "Copied" })}
      />
    </>
  );
}

function DownloadDialog({
  open,
  onOpenChange,
  os,
  onCopied,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  os: DetectedOS;
  onCopied: () => void;
}) {
  const cmd = installCommandFor(os);
  const [copied, setCopied] = React.useState(false);

  const copy = () => {
    navigator.clipboard?.writeText(cmd).then(() => {
      setCopied(true);
      onCopied();
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Install Apical for {osLabel(os)}</DialogTitle>
          <DialogDescription>
            {os === "other"
              ? "Pick your platform below."
              : "The desktop app is the fastest way to get started. If the download above didn't start, use the command below."}
          </DialogDescription>
        </DialogHeader>

        {os !== "other" && (
          <div className="space-y-3">
            <a
              href={downloadUrl(os)}
              className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Download className="h-4 w-4" /> Download {osLabel(os)} app
            </a>

            <div className="relative">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-2.5 pl-3">
                <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <code className="flex-1 truncate font-mono text-xs">{cmd}</code>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={copy}>
                  {copied ? <Check className="h-3.5 w-3.5 text-brand" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Or install from the command line.
              </p>
            </div>
          </div>
        )}

        {os === "other" && (
          <div className="space-y-2">
            {(["mac", "windows", "linux"] as DetectedOS[]).map((o) => (
              <a
                key={o}
                href={downloadUrl(o)}
                className="flex items-center justify-between rounded-lg border border-border p-3 text-sm hover:bg-accent/50"
              >
                <span>{osLabel(o)}</span>
                <Download className="h-4 w-4 text-muted-foreground" />
              </a>
            ))}
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button variant="outline" className="w-full" asChild>
            <a href="#developers">Build from source</a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
