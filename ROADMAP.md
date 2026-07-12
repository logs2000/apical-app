# Apical Roadmap

Apical is the AI agent that runs on **your** machine: your files, your API
keys, your data — nothing leaves your computer unless you say so. The core is
source-available (Elastic License 2.0, see [LICENSING.md](./LICENSING.md));
the cloud tier (runs while your laptop is closed, managed connector sign-in,
sync, teams) is the business.

Constraint the plan is built around: solo founder, full-time military pilot
training for the next ~18–36 months, ~5–8 productive hours/week, no capacity
for sales calls or high-touch onboarding. Every phase below is chosen to work
**asynchronously**.

---

## Phase 0 — Foundation (now)

**In this repo (done in this change):**
- [x] License the core under ELv2; mark the cloud plane proprietary; keep
      `apical-mcp` MIT (`LICENSE`, `LICENSING.md`).
- [x] Reposition landing page to local-first/BYOK; prune pricing to
      Free + Personal.
- [x] Repo hygiene: remove tracked scratch artifacts (`upload/`,
      `tool-results/`, root `download/`), fix the release workflow to stop
      writing the root manifest.
- [x] Open-core seam: engine/gateway no longer import billing/cloud modules
      directly; cloud features register at boot (`APICAL_EDITION`,
      see `OPEN-CORE-SPLIT.md`).

**Founder homework (cannot be done from the repo):**
- [ ] Form the LLC; open a business bank account.
- [ ] Confirm unit/state off-duty employment rules **in writing**; keep all
      work off military time, devices, and networks.
- [ ] File the "Apical" trademark (the real fork protection).
- [ ] Check the Vercel dashboard's root-directory setting before any
      `my-project-temp/` rename (CI + vercel.json reference it in ~18 places).
- [ ] Create the future **public** repo with a fresh history (single squashed
      initial commit). **Never publish this repo's git history** — it contains
      tracked tarballs, screenshots, and agent scratch in old commits.

## Phase 1 — Launch quietly, learn loudly (T-38 months, 5–8 hrs/week)

- Extract the open core into the public repo per `OPEN-CORE-SPLIT.md`.
- Drop the passcode gate. Show HN + r/LocalLLaMA + r/selfhosted with the
  local-first framing. The launch demo: one agent, five connectors that demo
  brilliantly (Filesystem, GitHub, Notion, Postgres, browser), scheduled runs.
- Open a Discord — the only support channel compatible with flight school.
  State the maintenance rhythm openly in the README ("triage Sundays").
- Build in public: one short post per week on what shipped and what users did.
- **One metric only: weekly active agents.** Not stars, not signups. Ten
  strangers whose agents run every week = signal.
- Feature-freeze everything not in service of that metric.

## Phase 2 — Charging season (post-wings / FTU)

- Turn on payments for the Personal tier early; 20 people at $19/mo teaches
  more than 2,000 free users.
- Cloud tier = runs while your computer is off + managed connector sign-in
  (our OAuth apps, no Google Cloud project required) + cross-device sync.
- **Bar to clear: $1k MRR before coming off full-time orders.** That is the
  line between "hobby with a website" and "business worth going full-time on."
- Passively collect the vertical signal: watch what users automate; the
  Phase 3 wedge should be discovered in usage data, not brainstormed.

## Phase 3 — Decision point (off full-time orders, part-time Guard)

- **Strong signal** ($1k+ MRR, retention, organic growth): go full-time.
  Fundraising is viable now — one-weekend-a-month Guard duty is a non-issue
  for investors. Consider military-founder channels (Bunker Labs, Techstars
  military cohorts) alongside ordinary pre-seed.
- **Modest signal:** run it as a bootstrapped side business. $5–20k MRR with
  no investors and no burn is a great outcome.
- **No signal:** total spend was ~$100/mo and the byproduct is a shipped
  product, an audience, and a proven-builder résumé. Cheapest MBA available.

## Standing rules

- Hire no one until revenue; a growth co-founder (real equity, full-time
  capacity) is the only "hire" worth considering, and only in Phase 3.
- Burn stays under ~$100/mo (domain, Vercel, LLC). BYOK pushes inference
  costs to users. A company that spends nothing cannot die.
- Apical never touches study time. A washed checkride helps no one; the
  product survives a slow month fine.
