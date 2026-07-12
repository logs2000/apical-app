# Apical Licensing

Apical uses a **source-available, open-core** model. The goal is simple: you
can read, run, modify, and self-host the core product freely — but nobody may
resell Apical or offer it to others as a competing hosted service. That
protection is permanent (it does not expire or convert to a permissive
license).

## The three license zones

| Zone | Paths | License |
|---|---|---|
| **Open core** | `my-project-temp/` (Next.js app, agent engine, connectors, workflows, desktop app in `src-tauri/`, local scheduler) — everything not listed below | [Elastic License 2.0](./LICENSE) |
| **Cloud plane (proprietary)** | `my-project-temp/mini-services/run-relay/`, `my-project-temp/mini-services/desktop-bridge/`, `my-project-temp/mini-services/scheduler/`, billing code (`src/lib/platform/billing.ts`, `src/lib/platform/run-billing.ts`, `src/app/api/billing/`) | All rights reserved (`UNLICENSED`) |
| **MCP client tool** | `my-project-temp/mini-services/apical-mcp/` | MIT |

## What you CAN do (ELv2 core)

- Use Apical for yourself or inside your company, personal or commercial, at
  any scale, for free.
- Run it locally with your own model API keys (BYOK) or local models.
- Read, modify, and build on the source; distribute your modifications.
- Contribute improvements back (see contribution note below).

## What you CANNOT do

- **Offer Apical (or a substantial part of it) to third parties as a hosted
  or managed service.** Running it for your own team is fine; running it for
  customers is not — that's the business that funds development.
- Remove, disable, or work around license-key functionality gating paid
  features.
- Remove Apical's copyright or licensing notices, or misuse the Apical name
  and marks.

## Why Elastic License 2.0?

ELv2 keeps the code open to individuals and companies using Apical for their
own work — the overwhelming majority of users — while permanently preventing
resale and competing hosted offerings. It is a widely recognized license used
by Elastic and others, and unlike time-delayed licenses (BSL/FSL) its
protection never lapses. Note: ELv2 is "source available," not OSI-approved
open source; we say so plainly rather than blur the term.

## Contributions

By submitting a contribution you certify the Developer Certificate of Origin
(DCO) — that you wrote the code or otherwise have the right to submit it under
the project's license — and you license your contribution to Apical under the
terms of the Elastic License 2.0. Sign-off via `git commit -s`.

## Commercial licensing

Need Apical under different terms (embedding, OEM, a hosted offering, or an
enterprise self-host license)? Contact the maintainer.
