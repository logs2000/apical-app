# Task 5 — API Routes for Connector Catalog, Agent Registration, Integration Sessions

## Agent: backend-api-routes
## Date: 2026-03-04

## Summary
Created 7 backend API route files for the Apical platform's connector catalog, agent registration, and integration sessions subsystems. All routes use Next.js App Router route handlers with TypeScript, Prisma ORM via `@/lib/db`, and proper error handling.

## Files Created

### 1. `/src/app/api/connectors/catalog/route.ts`
- **GET** — Returns connector catalog entries with optional filtering by `category`, `kind`, `status`, `search`
- Auto-seeds 12 default catalog entries (Gmail, Google Drive, Slack, Stripe, Notion, Salesforce, GitHub, HubSpot, QuickBooks, Jira, Shopify, MCP File System) when the table is empty
- Uses `upsert` to avoid duplicate seed entries
- Supports search across name, description, shortDesc, and slug fields

### 2. `/src/app/api/connectors/install/route.ts`
- **POST** — Installs a connector from the catalog for the current user
- Body: `{ connectorSlug: string }`
- Validates connector exists and is not "coming_soon"
- Creates an `Integration` record from the catalog entry's config/tools
- Increments the catalog entry's `installCount`
- Returns 201 with the created integration

### 3. `/src/app/api/agents/register/route.ts`
- **POST** — Registers an AI agent on the platform
- Body: `{ name, description, type, capabilities, callbackUrl }`
- Validates `name` and `type` (must be one of: llm, workflow, mcp_server, custom)
- Creates an `AgentRegistration` record
- Generates an `AgentApiKey` with `apk_` + 32-char hex format
- Stores SHA-256 hash + first 12 char prefix
- Returns `{ agent, apiKey }` with the raw key shown once (201)

### 4. `/src/app/api/agents/[id]/keys/route.ts`
- **GET** — Lists an agent's API keys (excluding hash, includes prefix)
- **POST** — Creates a new API key for an agent
- Key format: `apk_` + `crypto.randomBytes(32).toString('hex')`
- Hashes with `crypto.createHash('sha256')`, stores prefix (first 12 chars)
- Returns raw key at creation time only (shown once)

### 5. `/src/app/api/agents/[id]/connect/route.ts`
- **POST** — Requests a connection between an agent and a user's service
- Body: `{ serviceKey, scopes }`
- Validates agent and service catalog entry exist
- Handles existing connections (re-activates revoked ones)
- Creates `AgentConnection` with status "pending" (201)

### 6. `/src/app/api/integrations/session/route.ts`
- **POST** — Creates an integration session (login workaround)
- Body: `{ serviceSlug, sessionType, credentials, meta }`
- Validates sessionType (oauth | api_key | credentials | browser_login)
- Encrypts credentials using base64 encoding (placeholder for AES-256-GCM)
- Sets appropriate expiry based on session type
- Returns session without encrypted data for security (201)
- **GET** — Lists user's integration sessions with optional filtering

### 7. `/src/app/api/integrations/session/[id]/route.ts`
- **GET** — Gets a specific session with decrypted credentials
- **DELETE** — Revokes a session (sets status to "revoked")
- **PATCH** — Updates/refreshes a session (re-encrypts new credentials, extends expiry)

## Technical Details
- All routes use `import { db } from '@/lib/db'` for Prisma access
- All routes use `import { NextRequest, NextResponse } from 'next/server'`
- Proper HTTP status codes: 200, 201, 400, 404, 500
- Try/catch error handling on all endpoints
- API key generation uses `crypto.randomBytes(32)` for the key and `crypto.createHash('sha256')` for hashing
- Dynamic route params use `Promise<{ id: string }>` type per Next.js 16 conventions
- Database is already in sync — no schema changes were needed

## Verification
- `bun run db:push` — Database already in sync
- `bun run lint` — No errors (1 pre-existing warning unrelated to these files)
- Dev server running successfully
