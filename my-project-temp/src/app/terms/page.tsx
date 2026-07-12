import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/apical/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service — Apical",
  description: "The deal between you and Apical, in plain language.",
};

const UPDATED = "July 12, 2026";

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated={UPDATED}>
      <p>
        These terms are the deal between you and Apical when you use the web
        app, desktop app, or API. Short version: use it for real work, don&apos;t
        use it to harm people or systems, and understand that AI agents make
        mistakes.
      </p>

      <LegalSection title="The service">
        <p>
          Apical lets you describe tasks in plain language and have AI agents
          plan and execute them — on the web, against apps you connect, and (with
          the desktop app) on your own computer. Apical is currently in beta and
          free to use; paid plans will be introduced later with notice.
        </p>
      </LegalSection>

      <LegalSection title="Your account & your keys">
        <ul>
          <li>You&apos;re responsible for your account and for keeping your login secure.</li>
          <li>
            Model/provider keys and connected-app credentials you add remain
            yours; you can remove them at any time and we use them only to run
            your tasks.
          </li>
          <li>You must be legally able to enter these terms (and at least 13).</li>
        </ul>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>Don&apos;t use Apical to:</p>
        <ul>
          <li>break the law, or access accounts and systems you don&apos;t have rights to;</li>
          <li>harass, defraud, or harm others, or send spam;</li>
          <li>probe, overload, or disrupt the service or other people&apos;s infrastructure;</li>
          <li>build or run malware, or exfiltrate data you don&apos;t own.</li>
        </ul>
        <p>We can suspend accounts that do these things.</p>
      </LegalSection>

      <LegalSection title="Agents act on your instructions">
        <p>
          Agents do real things: send messages, modify files, call APIs. They
          act under your instructions and your connected permissions, and you
          own the results — including responsibility for reviewing them.
          AI output can be wrong; approval gates exist so you can check risky
          steps before they run, and you should use them for anything
          consequential.
        </p>
      </LegalSection>

      <LegalSection title="Your content">
        <p>
          Everything you put in — prompts, files, workflows — and everything
          agents produce for you stays yours. You give us only the license
          needed to store it, process it, and run it through the model providers
          you configured. See the{" "}
          <Link href="/privacy">Privacy Policy</Link> for how data is handled.
        </p>
      </LegalSection>

      <LegalSection title="Warranty & liability">
        <p>
          The service is provided <em>as is</em>, without warranties — during
          beta especially, features may change, break, or be removed. To the
          maximum extent the law allows, our total liability for any claim is
          limited to the amount you paid us in the twelve months before the
          claim (which, while Apical is free, is zero). Nothing here limits
          liability that can&apos;t legally be limited.
        </p>
      </LegalSection>

      <LegalSection title="Ending things">
        <p>
          You can stop using Apical and delete your account at any time. We can
          suspend or terminate accounts that violate these terms. On
          termination, your data is handled per the Privacy Policy.
        </p>
      </LegalSection>

      <LegalSection title="Changes & contact">
        <p>
          If these terms change materially we&apos;ll note it here with a new
          date and, for significant changes, in the product. Questions:{" "}
          <a href="mailto:hello@apic.al">hello@apic.al</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
