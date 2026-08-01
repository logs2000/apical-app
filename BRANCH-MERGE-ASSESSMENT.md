# Branch merge assessment

Written against `claude/apical-alpha-gap-1ef2oe` (forked from
`claude/apical-pipedream-integration-zmu0s8`), August 2026.

Every branch forks from the same point — `1da7c3d`, the tip of `main`. None of
them has been merged into another. They are four parallel lines of work, and
three of them contain code this branch does not have.

| Branch | Ahead of `main` | Overlaps this branch? | Verdict |
|---|---|---|---|
| `claude/apical-pipedream-integration-zmu0s8` | 2 | — this branch's base | Already here |
| `claude/apical-capabilities-gap-q3zunp` | 57 | Heavily (Pipedream, v1 API) | **Merge — highest value** |
| `claude/audit-dropdown-pages-n2pe6t` | 1 | Conflicts (predates Pipedream) | **Merge selectively** |
| `claude/apical-viability-analysis-5qd8yn` | 4 | `llm-gateway.ts` | Merge later, low urgency |

## Correction to the original gap analysis

The analysis said *"Pipedream Connect lives on a side branch, not merged here."*
That was true of `claude/apical-viability-analysis-5qd8yn`, which is what it was
written against. It is **not** true of this branch: `05e2b75 Make Pipedream
Connect the primary integration method` and `503bd67 Route workflow LLM through
in-house service` are both in this branch's history. Managed connectors are
already the primary path here.

---

## 1. `claude/apical-capabilities-gap-q3zunp` — merge this

57 commits, ~9,200 lines this branch doesn't have. It is the single largest
pool of unmerged work and it contains the safety layer the alpha needs.

### Already taken from it

Two pieces were ported in this branch's commit rather than waiting for a full
merge, because new code depended on them:

- **`net-guard.ts`** — SSRF guard with DNS-rebinding protection via connection
  pinning. Wired into `web_read`, `http_request`, and the new document URL
  loader. Before this, an agent could aim `http_request` at
  `169.254.169.254` and read cloud metadata. Verified blocking loopback,
  RFC1918, CGNAT, link-local, IPv6 ULA, IPv4-mapped IPv6, obfuscated IPv4
  (`0x7f000001`, `2130706433`), and internal-only hostnames.
- **sharp image downscaling** from its `images.ts` — resize to 1568px long
  side, re-encode, hard byte cap. A phone photo of an ID is routinely 4000px
  and 8MB; at 1568px it reads the same for a fraction of the token cost.

### Still to merge, in priority order

1. **`action-risk.ts` + `action-policy.ts`** — a destructive-action classifier
   and gate decision, enforced in the engine rather than left to the model's
   voluntary `request_review`. Whether the agent pauses before `rm -rf ~`
   should not depend on the LLM's judgment. Directly relevant: a filing
   workflow moves and overwrites real files.
2. **`restore.ts`** — before-image checkpoints per chat turn, so "revert to
   this message" can put files back. The natural failure mode of an intake
   workflow is *filed 200 documents into the wrong folders*; without undo,
   the recovery story is manual.
3. **`memory.ts` + `/api/memory`** — durable facts, preferences, and
   corrections extracted from turns. This branch still ships `memory-view.tsx`
   backed by a hardcoded `DEMO_WORKFLOWS` array.
4. **`skills.ts`** — reusable parameterized `WorkflowStep[]` fragments,
   invocable from both chat and frozen workflows. Useful, not alpha-blocking.
5. **`jobs/*`, `agent-run-worker.ts`, `run-stall.ts`** — durable background
   run execution with stall detection.
6. **`lib/api/*` + `/v1/openapi.json`** — shared route scaffolding and a
   published OpenAPI spec.
7. **`privacy`/`terms` pages** — needed before external testers, trivial.

### Merge risk

It rewrites `agent-tools.ts`, `agent-engine.ts`, and `llm-gateway.ts`, which
are exactly the files this branch changed. Expect real conflicts in all three.
Two specific collisions to resolve deliberately:

- **Media types.** That branch has `ImagePart` (images only). This branch has
  `MediaPart` (`image | document`), because a Medicaid PDF has to reach the
  model as a document block, not a filename. `MediaPart` is a superset — keep
  it, and port that branch's `image_read` tool onto it.
- **`net-guard.ts`** is now in both. Take theirs; it is the same file.

## 2. `claude/audit-dropdown-pages-n2pe6t` — merge selectively

One commit, but it removes ~4,900 lines of demo scaffolding and wires real
APIs. It **predates Pipedream**, so a naive merge deletes the entire Pipedream
integration (7 API routes, `pipedream-apps-section.tsx`,
`connect-account-card.tsx`, `pipedream-connect-client.ts`). Cherry-pick by
file; do not merge wholesale.

Worth taking:

- **Deletes `templates-view.tsx`** — the fake Templates card. It is still
  wired into `app-shell.tsx:327` and `command-menu.tsx:59` on this branch.
  The gap analysis called for "one golden-path demo workflow installed from
  NL (not a fake Templates card)"; this is the deletion half of that.
- **Real Settings / Billing / Data tabs** wired to live APIs.
- **`/api/memories`** — overlaps `capabilities-gap`'s `/api/memory`. Pick one
  (prefer the `capabilities-gap` version, which has the extraction pipeline)
  rather than landing both.
- **`/api/account`**.

Do **not** take: anything under `src/app/api/pipedream/`,
`src/lib/pipedream/`, or the two Pipedream components.

## 3. `claude/apical-viability-analysis-5qd8yn` — merge later

Four commits: Elastic License 2.0 open-core split with strategy docs, a
landing page repositioned around local-first agents, and boot-time seams that
decouple the core engine from the cloud plane (`cloud-adapter.ts`,
`cloud-registration.ts`, `entitlements.ts`, `run-events.ts`).

Good work, but it is licensing and packaging, not alpha capability. It also
touches `llm-gateway.ts` (58 lines, the cloud-relay seam), which conflicts
with the multimodal changes here. Merge it after `capabilities-gap`, when the
gateway has settled — resolving the same file against two branches at once is
avoidable pain.

---

## Suggested order

1. This branch (document primitives) — done.
2. `capabilities-gap` — resolve `agent-tools` / `agent-engine` / `llm-gateway`
   conflicts, keeping `MediaPart` over `ImagePart`.
3. `audit-dropdown-pages` — cherry-pick the Templates deletion and the real
   Settings/Billing/Data wiring; skip everything Pipedream.
4. `viability-analysis` — licensing and the cloud seam, once the gateway is
   stable.
