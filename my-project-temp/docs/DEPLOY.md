# Deploying Apical (single-box)

Apical ships as one Docker image that runs every role, orchestrated by
`docker-compose.yml`: the Next.js web app, four network mini-services
(`run-relay`, `scheduler`, `desktop-bridge`, `agent-worker`), a Postgres
database, and a Caddy edge proxy. They share one source tree, one
`node_modules`, and one generated Prisma client, so a service can never drift
from the app's schema.

```
                 ┌─────────┐
  browser ─────▶ │  caddy  │ :80
                 └────┬────┘
                      ▼
                 ┌─────────┐      ┌──────────────┐
                 │   app   │◀────▶│  run-relay   │ live streaming
                 │  :3000  │      │  scheduler   │ cron / schedules
                 └────┬────┘      │ desktop-bridge│ desktop FS/CLI tunnel
                      │           │ agent-worker │ durable runs + browser
                      ▼           └──────┬───────┘
                 ┌─────────┐             │
                 │postgres │◀────────────┘
                 └─────────┘
```

## Prerequisites

- Docker Engine 24+ and the Compose plugin (`docker compose version`).
- A machine with a normal storage driver (overlay2). ~4 GB RAM to start.
- At least one LLM provider key, or users linking their own Apical cloud token.

## Picking a box (cheap-first)

Any VPS that runs Docker works. Realistic starting points:

- **Oracle Cloud "Always Free"** — up to 4 ARM cores / 24 GB RAM, genuinely $0
  forever. Best free option; signup and regional capacity can be finicky.
- **Hetzner CX22 / CAX11** — ~€4/mo for 4 GB RAM. The dependable budget pick.
- **DigitalOcean / Vultr / Linode** — ~$6/mo for 1–2 GB (tight; prefer 4 GB).

PaaS free tiers (Render, Railway, Fly) are not a fit: this stack is six
always-on containers plus optional Chromium, which free tiers sleep, cap, or
price per-service. A VPS + the push-to-deploy workflow below gets you the same
"git push and it's live" feel at a fraction of the cost.

You can also skip the bundled Postgres and point `DATABASE_URL` at a managed
database (e.g. Supabase's free tier) — then don't start the `postgres`/`migrate`
dependency on it, and you get managed backups for free while the box only runs
the app + services.

## Quickstart

```bash
cp .env.docker.example .env.docker      # then fill in the secrets
docker compose --env-file .env.docker build
docker compose --env-file .env.docker up -d
curl http://localhost:8080/api/health   # {"status":"ok",...}
```

On `up`, a one-shot `migrate` service runs `db:release` (`prisma migrate
deploy` + registered backfills) and must complete before `app` and the
mini-services start. It never runs `prisma db push`.

## Configuration

All configuration comes from the environment (nothing secret is baked into the
image). Generate each secret with `openssl rand -base64 32`.

**Required**

| Variable | Purpose |
|---|---|
| `POSTGRES_PASSWORD` | Postgres superuser password (compose-internal). |
| `NEXTAUTH_SECRET` | Session signing. |
| `APICAL_VAULT_KEY` | AES-256-GCM key for encrypting stored credentials. |
| `APICAL_RELAY_SECRET`, `APICAL_SCHEDULER_SECRET`, `APICAL_BRIDGE_SECRET`, `AGENT_WORKER_SECRET` | Service-to-service auth. Each mini-service fails closed without its secret. |

**Web authentication** — choose one:

- *Hosted / multi-user*: set `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- *Self-hosted / single-user*: set `DESKTOP_LOCAL=true` and leave Supabase
  empty (uses the local credentials path).

**LLM providers** — set at least one so agents can answer:
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `XAI_API_KEY`.
`LLM_DEFAULT_PROVIDER` picks which configured provider is preferred for the
default model (otherwise Anthropic if set, else the first configured). Users can
also link their own Apical cloud token per account instead.

**Optional**: `APICAL_HTTP_PORT` (default 8080), `APICAL_PUBLIC_ORIGIN`
(your public URL, used for desktop-bridge CORS), `SMTP_URI` (email; log-only if
unset), `STRIPE_SECRET_KEY` (billing; demo mode if unset).

The app validates configuration at boot: it logs a grouped checklist and, in
production, refuses to start if a hard-required variable is missing (fail fast
instead of serving a broken app). Demo OAuth connections are disabled in
production unless `ALLOW_DEMO_OAUTH=true`.

## Push-to-deploy (Vercel-like)

`.github/workflows/deploy.yml` gives the compose stack a Vercel-style flow:
every push to `main` SSHes into the box, fast-forwards the checkout, rebuilds,
migrates, restarts, and fails the workflow unless `/api/health` comes back.
It is a silent no-op until the secrets exist, so setup is:

**One-time on the box** (Ubuntu/Debian):

```bash
curl -fsSL https://get.docker.com | sh          # Docker + compose plugin
sudo mkdir -p /opt/apical && sudo chown $USER /opt/apical
git clone https://github.com/logs2000/apical-app /opt/apical
cd /opt/apical/my-project-temp
cp .env.docker.example .env.docker && $EDITOR .env.docker   # fill in secrets
bash scripts/deploy/update.sh                   # first build + migrate + up
```

**One-time on GitHub** (repo → Settings → Secrets and variables → Actions):

- `DEPLOY_HOST` — the box's IP or hostname
- `DEPLOY_USER` — SSH user (must be able to run docker)
- `DEPLOY_SSH_KEY` — a dedicated ed25519 private key; put its `.pub` in the
  user's `~/.ssh/authorized_keys` (`ssh-keygen -t ed25519 -f deploy_key`)
- `DEPLOY_PATH` — optional, defaults to `/opt/apical`

From then on, merging to `main` deploys. `workflow_dispatch` lets you redeploy
the current main by hand, and `scripts/deploy/update.sh` is the same script you
can run on the box directly.

## TLS

The bundled Caddy terminates plain HTTP on `:80`. For real TLS, change the site
address in `docker/Caddyfile` from `:80` to your domain and publish `:443` in
`docker-compose.yml`; Caddy provisions and renews certificates automatically.

## Health & monitoring

`GET /api/health` reports liveness + readiness for load balancers and uptime
monitors: `ok` (reachable + fully configured), `degraded` (reachable but config
incomplete), or `down` (DB unreachable → HTTP 503). It returns only booleans,
never secrets. The `app` service also has a compose healthcheck against it.

## Operations

**Apply a schema change** (new image with new migrations):

```bash
docker compose --env-file .env.docker build
docker compose --env-file .env.docker run --rm migrate   # migrate deploy + backfill
docker compose --env-file .env.docker up -d
```

**Rotate the vault key** (zero downtime):

1. Generate a new key: `openssl rand -base64 32`.
2. Redeploy with `APICAL_VAULT_KEY=<new>` and `APICAL_VAULT_KEY_PREVIOUS=<old>`.
   New writes use the new key; existing data still decrypts via the old one.
3. Re-encrypt everything: `docker compose --env-file .env.docker exec app bun run db:rotate-vault`.
4. When it reports `0` remaining, drop `APICAL_VAULT_KEY_PREVIOUS` and redeploy.

**Back up** the `pgdata` volume (Postgres) and the `uploads` volume (locally
stored assets). A logical dump: `docker compose exec postgres pg_dump -U
postgres apical > backup.sql`.

**Logs**: `docker compose --env-file .env.docker logs -f app` (or any service).

**Untrusted-code limits**: agent scripts run under `prlimit` caps
(CPU / memory / processes / file size), overridable via `APICAL_SANDBOX_*`. Full
container isolation is out of scope for this single-box image.

## Scaling notes

This single-box layout runs all roles on one host with in-memory rate limiting
and a single relay. To scale out — multiple app replicas, Redis-backed rate
limits + socket.io adapter, separately scaled workers — is future work; the
env-configurable service URLs (`RELAY_URL`, `BRIDGE_URL`, `AGENT_WORKER_URL`)
are the seam to split on.

## CI

`.github/workflows/ci.yml` enforces the release gates on every PR: install,
typecheck, unit tests (`bun test`), lint (at the known baseline), the full smoke
suite against a Postgres service, and `next build`.
