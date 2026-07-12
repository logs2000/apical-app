# Open-Core Split Map

How Apical divides into the **ELv2 open core** (everything a user needs to run
agents locally, free forever) and the **proprietary cloud plane** (the hosted
business: always-on runs, managed OAuth, sync, billing, teams). This map is
the blueprint for extracting the public repo (Phase 1 in `ROADMAP.md`). All
paths are relative to `my-project-temp/`.

## Design rule

The core must **build and run with zero cloud modules present**. Cloud
features activate by *registration at boot*, never by direct import from core
code. The seam is controlled by the `APICAL_EDITION` env var
(`cloud` = default, current behavior; `core` = skip cloud registration).

## Open core (Elastic License 2.0)

| Area | Paths |
|---|---|
| Agent engine (ReAct loop) | `src/lib/platform/agent-engine.ts`, `agent-tools.ts`, `agent-credentials.ts` |
| Workflows | `src/lib/platform/workflow-executor.ts`, `workflow-generate.ts`, `workflow-validate-server.ts`, `workflow-distill.ts`, `workflow-revisions.ts`, `workflow-trace.ts` |
| LLM gateway (BYOK/local adapters) | `src/lib/platform/llm-gateway.ts`, `models.ts` |
| Local runtime & desktop | `src/lib/platform/desktop-local-runtime.ts`, `desktop-tools.ts`, `local-scheduler.ts`, `folder-watch.ts`, `granted-folders.ts`, `src/lib/desktop/` (incl. offline license verification), `src-tauri/` |
| Supporting libs | `src/lib/platform/vault.ts`, `cron.ts`, `web-search.ts`, `script-runner.ts`, `data-plugins.ts`, connectors/MCP client code (`src/lib/mcp-client.ts`, `mcp-directory.ts`) |
| UI | `src/app/` and `src/components/` except the billing routes/components below |
| Seam modules (new) | `src/lib/platform/entitlements.ts`, `cloud-adapter.ts`, `run-events.ts`, `cloud-registration.ts` |
| MCP dev tool | `mini-services/apical-mcp/` (**MIT**, not ELv2 — client tool, wide adoption benefits us) |

## Cloud plane (proprietary, all rights reserved)

| Area | Paths |
|---|---|
| Billing & plans | `src/lib/platform/billing.ts`, `run-billing.ts`, `pricing.ts`, `token-allowance-config.ts`, `src/app/api/billing/**`, `src/app/api/admin/token-limits/` |
| Cloud LLM relay | `src/lib/platform/cloud-llm.ts`, `cloud-pat.ts`, `cloud-entitlements.ts`, `src/app/api/settings/cloud-pat/` |
| Run event relay | `src/lib/relay-client.ts`, `src/lib/relay-token.ts`, `src/app/api/runs/[id]/relay-token/`, `mini-services/run-relay/` |
| Hosted↔desktop bridge | `mini-services/desktop-bridge/` |
| Cloud scheduler | `mini-services/scheduler/` (local twin `local-scheduler.ts` stays in core) |

## The seam (what was changed and why)

Recon finding: `agent-engine.ts`, `agent-tools.ts`, and `workflow-executor.ts`
had **zero** cloud/billing imports already. The coupling was concentrated in
`llm-gateway.ts` (imported `cloud-llm`, `cloud-pat`, `pricing`) and in three
files importing `broadcastRun` from `relay-client.ts`. The scaffold cut those
edges:

1. **`src/lib/platform/entitlements.ts`** — `Entitlements` interface +
   `coreEntitlements` default (unlimited local use, BYOK always allowed) +
   `setEntitlements()` registry. `llm-gateway.ts` consults the registry
   instead of importing `pricing.ts`. The cloud implementation
   (`cloud-entitlements.ts`) wraps `pricing.ts` + `token-allowance-config.ts`.
2. **`src/lib/platform/cloud-adapter.ts`** — contract for the hosted LLM
   relay (`cloudChat`, `cloudChatStream`, `cloudListModels`,
   `isCloudRelayAvailable`) + `setCloudAdapter()`. Gateway `cloud-relay`
   branches guard on adapter presence; without registration they fall back
   to BYOK/local.
3. **`src/lib/platform/run-events.ts`** — `broadcastRun` shim; no-op unless a
   publisher is registered. `start-run.ts`, `run-supervision.ts`, and
   `src/lib/runtime.ts` import this instead of `relay-client.ts`.
4. **`src/lib/platform/cloud-registration.ts`** — called at server boot
   (`instrumentation.ts`); registers the three cloud implementations unless
   `APICAL_EDITION=core`.

## Extraction checklist (when creating the public repo)

- [ ] Fresh repo, single squashed initial commit (this repo's history contains
      tracked tarballs/screenshots — never publish it).
- [ ] Copy the open-core paths above; omit the cloud-plane paths.
- [ ] Delete `cloud-registration.ts`'s cloud imports (or replace the file with
      the no-op core variant) — the seam guarantees nothing else references
      cloud modules.
- [ ] Prisma schema: prune cloud-only models (Subscription, TokenUsageRecord,
      DesktopSession relay fields, etc.) or ship the full schema and let the
      core simply not use them — decide at extraction time; the local SQLite
      path must work out of the box.
- [ ] `LICENSE` (ELv2) + `LICENSING.md` + DCO note in `CONTRIBUTING.md`.
- [ ] CI: build + lint on PRs; the desktop release workflow moves with the
      public repo.
