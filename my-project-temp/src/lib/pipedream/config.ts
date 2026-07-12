// Apical — Pipedream Connect configuration (A0, the primary acquisition path).
//
// Pipedream Connect is Apical's managed connection layer: users link
// third-party accounts through Pipedream's hosted auth, tokens stay in
// Pipedream's vault, and Apical stores only non-secret account references
// (`apn_...` ids). Everything in src/lib/pipedream fails soft when these env
// vars are unset — self-hosted deployments that decline the managed path keep
// today's direct OAuth/MCP/OpenAPI behavior unchanged.

import { getAppUrl } from '../oauth-helpers'

export type PipedreamEnvironment = 'development' | 'production'

export interface PipedreamConfig {
  clientId: string
  clientSecret: string
  projectId: string
  environment: PipedreamEnvironment
  webhookSecret: string | null
  allowedOrigins: string[]
}

/** Read the Pipedream env vars. Returns null unless all required vars are set. */
export function getPipedreamConfig(): PipedreamConfig | null {
  const clientId = (process.env.PIPEDREAM_CLIENT_ID || '').trim()
  const clientSecret = (process.env.PIPEDREAM_CLIENT_SECRET || '').trim()
  const projectId = (process.env.PIPEDREAM_PROJECT_ID || '').trim()
  if (!clientId || !clientSecret || !projectId) return null

  const rawEnv = (process.env.PIPEDREAM_PROJECT_ENVIRONMENT || 'development').trim().toLowerCase()
  const environment: PipedreamEnvironment = rawEnv === 'production' ? 'production' : 'development'

  const webhookSecret = (process.env.PIPEDREAM_WEBHOOK_SECRET || '').trim() || null

  const rawOrigins = (process.env.PIPEDREAM_ALLOWED_ORIGINS || '').trim()
  const allowedOrigins = rawOrigins
    ? rawOrigins.split(',').map((o) => o.trim()).filter(Boolean)
    : [getAppUrl()]

  return { clientId, clientSecret, projectId, environment, webhookSecret, allowedOrigins }
}

/** Single source of truth for "is the managed connection path available?" */
export function isPipedreamConfigured(): boolean {
  return getPipedreamConfig() !== null
}
