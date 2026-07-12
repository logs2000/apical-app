# Apical — Brand & Positioning

*The strategy doc. What we say, where we sit, and the words we use.
Written July 2026, pre-launch.*

---

## 1. The insight

Software that does work for you comes from two aisles today.

**Aisle one: the automation platforms.** Zapier, Make, n8n. Utterly reliable,
totally unattended — and dumb on purpose. They only do what you flowcharted.
You are the brain; they are the hands; and you must wire every finger. When
reality deviates from the diagram — a weird PDF, a renamed column, a vendor
who writes "invoice attached" with no attachment — the pipeline breaks and
waits for you.

**Aisle two: the AI agents.** Claude, ChatGPT. Judgment on tap — they read the
weird PDF, infer what you meant, adapt. But they're passenger-seat products.
Present-tense. You're there: prompting, watching, approving. A brilliant temp
who does great work *while you stand next to them* — and goes home when you
close the tab.

So the market offers **automation without judgment** or **judgment without
employment**. The gap between the aisles is the whole prize:

> **Judgment, employed.**

That's the quadrant Apical owns.

## 2. The map (own this mentally, put it on slides)

```
  needs you there ────────────────────────▶ works while you sleep
 ▲
 │            ChatGPT / Claude  ┃   ★ APICAL
 │            (brilliant, but   ┃   (thinks like an agent,
 │             you babysit it)  ┃    shows up like a cron job)
 │  thinks    ━━━━━━━━━━━━━━━━━━╋━━━━━━━━━━━━━━━━━━━━━━━
 │            (nothing lives    ┃   Zapier / Make / n8n
 │             down here — a    ┃   (reliable, but only does
 │             dumb tool you    ┃    what you flowcharted)
 ▼  repeats    must watch)      ┃
```

Two axes: **how much it thinks** (repeats rules → exercises judgment) and
**how much it needs you** (works while you watch → works while you sleep).
Zapier owns the bottom-right. The chatbots own the top-left. The top-right
was empty. We live there.

## 3. Category & positioning statement

**Category:** the **agent workforce platform** — the delegation layer that
sits between your tools (where work happens) and the frontier models (where
judgment comes from), and turns the second into staff for the first.

**Positioning statement:**

> For people and small teams drowning in operational busywork, **Apical is
> the agent workforce platform**: you describe an outcome in plain language,
> and it becomes a working agent — scheduled, supervised, reporting back.
> Unlike Zapier or n8n, there's no flowchart to build. Unlike ChatGPT or
> Claude, there's nothing to babysit. And unlike all of them: **your models,
> your keys, your box.**

## 4. The brand idea

One organizing thought everything hangs off:

> ## **Where agents go to work.**

Chat apps are where agents *visit*. Apical is where they're *employed* — with
jobs, schedules, supervision, and a morning report. Every product concept
already maps to employment language, which makes the metaphor load-bearing
instead of decorative:

| Product concept | Employment frame |
|---|---|
| Saved agent + schedule | a hire with a job description and working hours |
| Durable runs (survive closed tabs) | it doesn't stop working when you stop watching |
| Approval gates | it checks with the manager before anything risky |
| Daily/weekly briefs | it reports to you, not the other way around |
| Vault + connections | its keycard — access you granted, revocable |
| Run history | its timesheet |

## 5. Slogans

**Masterbrand** (logo lockup, one per company):

> **Apical — where agents go to work.**

**The behavior line** (campaigns, the phrase we want in people's mouths at
the moment of drudgery, the way "there's an app for that" worked):

> **Put an agent on it.**

**Hero headline + subhead** (landing page):

> **Automation that thinks. Agents that show up.**
> No flowcharts to build. Nothing to babysit. Describe the job — Apical
> hires it out to an agent that runs on a schedule and reports back.

**The nerd line** (developer audiences, API docs, HN):

> **The judgment of a frontier model. The work ethic of a cron job.**

**The triangulation ad** (paid/social, three lines, names the aisles):

> Zapier repeats.
> Chatbots chat.
> **Apical works.**

**Supporting lines** (rotate through site sections, emails, empty states):

- *Delegation, not configuration.*
- *Judgment on a schedule.*
- *It doesn't stop working when you stop watching.*
- *While you slept: 32 invoices filed, 2 flagged for you.* (always use real,
  concrete, small numbers — never "10x")
- *Your models. Your keys. Your box.* (the ownership pillar, verbatim)
- *Copilots need pilots.* (competitive, use sparingly)

## 6. Messaging pillars (with proof from the actual product)

Every pillar must be provable in the product on the day it's claimed. These
four are, today:

**1. It thinks, so you don't wire.** *(the anti-Zapier/Make/n8n pillar)*
Describe the outcome; the agent plans the steps and handles the mess —
the weird PDF, the missing column, the judgment call. Any successful ask can
be saved as a repeatable workflow with one tap.
*Proof: planning engine with visible step checklists; save-as-workflow;
no node editor exists in the product at all.*

**2. It's employed, not visiting.** *(the anti-chatbot pillar)*
Agents run on schedules, survive closed tabs, queue durably through restarts,
pause at approval gates for consequential actions, and send you the brief
instead of waiting for you to check.
*Proof: durable run worker with leases and crash recovery; cron scheduler;
gate flow with email notify; daily/weekly briefs.*

**3. It's yours.** *(the pillar no model vendor can copy)*
Bring any model — OpenAI, Anthropic, Google, xAI, or a local Ollama — under
your keys, or link an Apical cloud token. Or take the whole platform home:
one `docker compose up` runs everything on your box, credentials sealed in a
vault with *your* encryption key.
*Proof: multi-provider gateway; single-box compose deploy; AES-256-GCM vault
with key rotation; public /v1 API with scoped keys, webhooks, OpenAPI.*

**4. No theater.** *(the trust pillar — earned, don't preach it)*
Statuses are real. Failures say what went wrong and what to do. Nothing shows
"connected" or "sent" unless it happened. This is a policy with receipts, not
a value statement.
*Proof: the launch audit — honest model-availability gate, no fake email
'sent', demo OAuth off in production, worker-unavailable signal, runs never
'complete' empty.*

## 7. Competitive one-liners

Keep in the drawer; deploy in comparisons, sales, and replies — not the hero.

- **vs Zapier/Make:** "Zapier does what you said. Apical does what you meant."
- **vs Zapier/Make (second):** "A flowchart is you doing the thinking in
  advance. Stop pre-thinking."
- **vs n8n:** "n8n gives you 400 nodes. Apical gives you your Tuesday back."
- **vs ChatGPT agents / Claude Cowork:** "A brilliant intern you have to
  watch is still a job. Apical clocks in without you."
- **vs both aisles:** "Pipelines wait for instructions. Chatbots wait for
  you. Apical just works."
- **The ownership kicker (vs every model-vendor product):** "Their agent
  runs in their cloud on their model. Yours runs on your box, on whatever
  model you choose."

## 8. Voice & language system

**Voice:** a competent hire's first week. Plain, calm, concrete, lightly dry.
States what it did, admits what it couldn't, never oversells. The product's
honesty policy *is* the brand voice.

**Vocabulary (use / avoid):**

| Say | Not | Because |
|---|---|---|
| ask | prompt | people delegate; engineers prompt |
| agent | bot, assistant, copilot | it holds a job; it doesn't ride along |
| job, schedule | workflow config | employment frame |
| gate | human-in-the-loop | one syllable, means the same |
| brief | notification digest | reports up, like staff do |
| vault | integrations settings | keys are serious |
| "it runs" | "it's magic" | it isn't magic; it's infrastructure |

**Banned:** magic, supercharge, revolutionize, 10x, "AI-powered" (everything
is), copilot (that's the other aisle's word), any number we can't screenshot.

**Concreteness rule:** every claim is a small true sentence. "Filed 32
invoices, flagged 2" beats "handles your finances." If marketing can't be
screenshotted from a real run, it doesn't ship.

## 9. The name (brand story, use in About/manifesto)

*Apical*, from the *apical meristem* — the tissue at the growing tip of a
plant. It's the small part where all new growth originates, so the rest of
the plant doesn't have to grow itself. That's the job description: **be the
growing tip of your company.** The part that keeps pushing forward while
everything else stays focused on being what it already is.

## 10. Where it lands (application map)

- **Landing hero:** "Automation that thinks. Agents that show up." + the
  no-flowcharts/no-babysitting subhead. (Current "Consider it Done." is a
  fine chat greeting; it's too generic to carry the position.)
- **Pricing page:** keep "free while in beta"; frame tiers by *workforce
  size* — how many agents on staff, how often they run.
- **Docs / developer page:** lead with the nerd line and the /v1 surface —
  "the delegation layer with an API."
- **Empty states:** hiring language. "No agents on staff yet. Give one a job."
- **The daily brief email:** subject line is the brand promise delivered:
  "While you slept: …" — make it the product's signature artifact.
- **Launch post title:** "Zapier repeats. Chatbots chat. Apical works."

## 11. What we don't say (anti-positioning)

- We don't out-chat ChatGPT. Never lead with the chat experience; it's the
  on-ramp, not the product.
- We don't out-node n8n. No "500+ integrations" arms race framing; we sell
  outcomes, not connectors.
- We don't claim autonomy we don't have. Gates exist because judgment needs
  supervision; that's a feature and we say it plainly.
- We don't punch at Anthropic/OpenAI as companies — their models are our
  workforce's brains. The contrast is *product shape* (session vs. employed),
  never model quality.
