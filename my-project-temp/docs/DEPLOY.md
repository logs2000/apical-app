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
