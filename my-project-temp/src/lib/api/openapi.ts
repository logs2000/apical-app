// OpenAPI 3.1 spec for the canonical /v1 surface, assembled from a single
// endpoint manifest (V1_ENDPOINTS). This is the source of truth for the API
// docs — the old hand-written /api/dev/docs blob drifted from the routes
// because nothing tied them together. Here the manifest is cross-checked
// against the actual route files by scripts/smoke/18-openapi-drift.ts, so a
// route added/removed without a matching manifest entry fails the suite.
//
// Served at GET /v1/openapi.json (public).

import { API_KEY_SCOPES, type ApiKeyScope } from '../api-key-auth'
import { API_ERROR_CODES } from './errors'

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export interface EndpointDef {
  method: HttpMethod
  /** OpenAPI path with {param} placeholders, e.g. /v1/workflows/{id}. */
  path: string
  summary: string
  /** Required scope, or null for public endpoints (their own auth). */
  scope: ApiKeyScope | null
  /** True for cursor-paginated list endpoints (adds limit/cursor params). */
  paginated?: boolean
  /** True when the endpoint accepts a JSON request body. */
  hasBody?: boolean
}

// The complete /v1 operation inventory. Order groups related resources.
export const V1_ENDPOINTS: EndpointDef[] = [
  // Workflows
  { method: 'GET', path: '/v1/workflows', summary: 'List workflows', scope: 'workflows:read', paginated: true },
  { method: 'POST', path: '/v1/workflows', summary: 'Create a workflow from a WorkflowJSON document', scope: 'workflows:write', hasBody: true },
  { method: 'GET', path: '/v1/workflows/{id}', summary: 'Get one workflow', scope: 'workflows:read' },
  { method: 'PATCH', path: '/v1/workflows/{id}', summary: 'Update metadata and/or replace steps', scope: 'workflows:write', hasBody: true },
  { method: 'DELETE', path: '/v1/workflows/{id}', summary: 'Delete a workflow', scope: 'workflows:write' },
  { method: 'POST', path: '/v1/workflows/{id}/run', summary: 'Trigger a run (?wait=true blocks ≤60s)', scope: 'runs:execute', hasBody: true },
  { method: 'POST', path: '/v1/workflows/{id}/dry-run', summary: 'Simulate a run with no external effects', scope: 'workflows:read' },
  { method: 'GET', path: '/v1/workflows/{id}/revisions', summary: 'List workflow revisions', scope: 'workflows:read' },
  { method: 'POST', path: '/v1/workflows/{id}/revisions', summary: 'Roll back to a revision (append-only)', scope: 'workflows:write', hasBody: true },
  { method: 'GET', path: '/v1/workflows/{id}/trigger-url', summary: 'Get the inbound trigger URL', scope: 'workflows:read' },
  { method: 'POST', path: '/v1/workflows/{id}/trigger-url', summary: 'Mint/rotate the inbound trigger URL', scope: 'workflows:write' },
  { method: 'DELETE', path: '/v1/workflows/{id}/trigger-url', summary: 'Disable the inbound trigger URL', scope: 'workflows:write' },
  { method: 'POST', path: '/v1/workflows/validate', summary: 'Validate a WorkflowJSON document without saving', scope: 'workflows:read', hasBody: true },
  { method: 'POST', path: '/v1/workflows/generate', summary: 'Generate a draft workflow from a natural-language spec', scope: 'workflows:write', hasBody: true },
  { method: 'GET', path: '/v1/workflows/generate/{jobId}', summary: 'Poll a generation job', scope: 'workflows:read' },
  // Runs
  { method: 'GET', path: '/v1/runs', summary: 'List runs', scope: 'runs:read', paginated: true },
  { method: 'GET', path: '/v1/runs/{id}', summary: 'Get one run with steps', scope: 'runs:read' },
  { method: 'POST', path: '/v1/runs/{id}/gate', summary: 'Approve/reject a run paused at a gate', scope: 'runs:execute', hasBody: true },
  { method: 'POST', path: '/v1/runs/{id}/rerun', summary: 'Re-run a failed run from a step', scope: 'runs:execute', hasBody: true },
  // Credentials + accounts
  { method: 'GET', path: '/v1/credentials', summary: 'List vault credentials (secrets redacted)', scope: 'credentials:manage', paginated: true },
  { method: 'POST', path: '/v1/credentials', summary: 'Add a credential to the vault', scope: 'credentials:manage', hasBody: true },
  { method: 'GET', path: '/v1/connected-accounts', summary: 'List end-customer accounts', scope: 'credentials:manage', paginated: true },
  { method: 'POST', path: '/v1/connected-accounts', summary: 'Register an end-customer account', scope: 'credentials:manage', hasBody: true },
  // Usage + registry
  { method: 'GET', path: '/v1/usage', summary: 'Workspace balance, plan, per-key spend', scope: 'usage:read' },
  { method: 'GET', path: '/v1/registry/integrations', summary: 'Connector registry visible to the workspace', scope: 'registry:read' },
  // Webhooks
  { method: 'GET', path: '/v1/webhooks', summary: 'List webhook endpoints', scope: 'webhooks:manage', paginated: true },
  { method: 'POST', path: '/v1/webhooks', summary: 'Register a webhook endpoint', scope: 'webhooks:manage', hasBody: true },
  { method: 'PATCH', path: '/v1/webhooks/{id}', summary: 'Update a webhook endpoint', scope: 'webhooks:manage', hasBody: true },
  { method: 'DELETE', path: '/v1/webhooks/{id}', summary: 'Delete a webhook endpoint', scope: 'webhooks:manage' },
  { method: 'GET', path: '/v1/webhooks/{id}/deliveries', summary: 'List webhook delivery attempts', scope: 'webhooks:manage', paginated: true },
  // Public inbound trigger
  { method: 'POST', path: '/v1/hooks/w/{id}/{secret}', summary: 'Inbound trigger — start a run (secret in URL)', scope: null, hasBody: true },
]

function pathParams(path: string): Array<Record<string, unknown>> {
  return [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }))
}

const PAGINATION_PARAMS = [
  { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
  { name: 'cursor', in: 'query', required: false, schema: { type: 'string' }, description: 'Opaque cursor from a prior page (page.nextCursor).' },
]

/** Build the full OpenAPI 3.1 document for /v1. `origin` seeds the server URL. */
export function buildOpenApiSpec(origin: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const ep of V1_ENDPOINTS) {
    const op: Record<string, unknown> = {
      summary: ep.summary,
      operationId: `${ep.method.toLowerCase()}${ep.path.replace(/[/{}]/g, '_')}`,
      parameters: [...pathParams(ep.path), ...(ep.paginated ? PAGINATION_PARAMS : [])],
      responses: {
        '2XX': {
          description: 'Success. Body is { data } (single) or { data, page } (list).',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } },
        },
        '4XX': {
          description: 'Error envelope.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
      ...(ep.scope
        ? { security: [{ bearerAuth: [ep.scope] }], 'x-required-scope': ep.scope }
        : { security: [] }),
    }
    if (ep.hasBody) {
      op.requestBody = {
        required: true,
        content: { 'application/json': { schema: { type: 'object' } } },
      }
    }
    paths[ep.path] = { ...(paths[ep.path] ?? {}), [ep.method.toLowerCase()]: op }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Apical API',
      version: '1.0.0',
      description:
        'The canonical Apical REST API. Authenticate with a workspace API key ' +
        '(Authorization: Bearer ap_...). Responses use a { data } / { error: ' +
        '{ code, message, details? } } envelope; lists are cursor-paginated ' +
        'via { data, page: { nextCursor, hasMore } }.',
    },
    servers: [{ url: origin }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Workspace API key. Scopes: ' + API_KEY_SCOPES.join(', ') + '.',
        },
      },
      schemas: {
        Success: {
          type: 'object',
          required: ['data'],
          properties: {
            data: {},
            page: { $ref: '#/components/schemas/Page' },
          },
        },
        Page: {
          type: 'object',
          required: ['nextCursor', 'hasMore'],
          properties: {
            nextCursor: { type: ['string', 'null'] },
            hasMore: { type: 'boolean' },
          },
        },
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string', enum: [...API_ERROR_CODES] },
                message: { type: 'string' },
                details: {},
              },
            },
          },
        },
      },
    },
    paths,
  }
}
