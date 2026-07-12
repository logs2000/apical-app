import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/apical/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy — Apical",
  description: "What Apical collects, why, and what we never do with it.",
};

const UPDATED = "July 12, 2026";

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated={UPDATED}>
      <p>
        Apical runs tasks on your behalf. Doing that means we necessarily handle
        some of your data. This page says plainly what we collect, why, and what
        we never do with it. It applies to the Apical web app, desktop app, and
        API.
      </p>

      <LegalSection title="What we collect">
        <ul>
          <li>
            <strong>Account basics</strong> — your email address and name, via
            our authentication provider (Supabase).
          </li>
          <li>
            <strong>The work you give Apical</strong> — the tasks you type,
            files you attach, workflows and schedules you save, and the results
            agents produce. This is the product; it&apos;s stored so your agents
            can run and you can see what they did.
          </li>
          <li>
            <strong>Connected accounts</strong> — when you connect an app
            (Gmail, Slack, etc.) we store OAuth tokens; when you add a model or
            service key we store that credential. All credentials are encrypted
            at rest (AES-256-GCM) and are used only to run the tasks you ask
            for.
          </li>
          <li>
            <strong>Operational logs</strong> — run history, errors, and basic
            request metadata (like IP-derived rate-limit counters) needed to
            keep the service working and abuse out.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="How your data is used by AI models">
        <p>
          When an agent works on your task, the relevant content (your prompt,
          the files or app data the task needs) is sent to the model provider
          you configured — e.g. Anthropic, OpenAI, or Google — under{" "}
          <em>your</em> key, or to your linked Apical cloud account. We don&apos;t
          send your data to any model you didn&apos;t set up, and we don&apos;t
          use your data to train models.
        </p>
      </LegalSection>

      <LegalSection title="What we never do">
        <ul>
          <li>We don&apos;t sell your data. To anyone. Ever.</li>
          <li>We don&apos;t use your tasks, files, or credentials for advertising.</li>
          <li>
            We don&apos;t read your connected accounts except to execute tasks
            you explicitly asked for.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="The desktop app">
        <p>
          The desktop app can read and write local files and run commands{" "}
          <em>on your machine</em> — that&apos;s its point. It only does so for
          tasks you run, its access is controlled by the permission settings you
          choose (including turning command access off entirely), and local file
          contents are processed to complete your task, not harvested.
        </p>
      </LegalSection>

      <LegalSection title="Deleting your data">
        <p>
          Delete a credential, workflow, or file and it&apos;s removed from the
          live database. Delete your account (Settings, or email us) and we
          remove your account data — allowing up to 30 days for backups to
          rotate out.
        </p>
      </LegalSection>

      <LegalSection title="Where data lives">
        <p>
          Data is stored in our hosting providers&apos; infrastructure (our
          database and, for authentication, Supabase). Payment processing, when
          it launches, will be handled by Stripe — card numbers never touch our
          servers.
        </p>
      </LegalSection>

      <LegalSection title="Changes & contact">
        <p>
          If this policy changes materially we&apos;ll note it here with a new
          date at the top. Questions or requests:{" "}
          <a href="mailto:hello@apic.al">hello@apic.al</a>. See also our{" "}
          <Link href="/terms">Terms of Service</Link>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
