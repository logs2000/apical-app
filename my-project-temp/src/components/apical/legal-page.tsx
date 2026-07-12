import Link from "next/link";
import type { ReactNode } from "react";
import { ApicalMark, ApicalName } from "@/components/apical/logo";

/** Shared shell for /privacy and /terms — server-rendered, no client JS. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/50">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 md:px-6">
          <Link href="/" className="flex items-center gap-2">
            <ApicalMark className="h-5 w-5" />
            <ApicalName className="h-4" />
          </Link>
          <nav className="flex items-center gap-4 text-xs text-muted-foreground">
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground">Terms</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-12 md:px-6">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated {updated}</p>
        <div className="prose-legal mt-8 space-y-4 text-sm leading-relaxed text-foreground/90 [&_a]:underline [&_a]:underline-offset-2 [&_em]:italic [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
          {children}
        </div>
      </main>
      <footer className="border-t border-border/50 py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Apical ·{" "}
        <Link href="/" className="hover:text-foreground">Home</Link>
      </footer>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pt-4">
      <h2 className="mb-2 text-lg font-semibold tracking-tight">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
