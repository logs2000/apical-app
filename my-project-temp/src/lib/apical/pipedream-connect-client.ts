// Apical — browser-side Pipedream Connect launcher.
//
// One entry point for every "Connect your <App> account" affordance (vault
// Apps section, in-chat connect card, run reconnect gate). Primary path is
// the @pipedream/sdk browser client (hosted auth iframe — no popup blockers);
// fallback is the hosted Connect Link in a popup window plus polling of
// /api/pipedream/accounts?sync=1 until the connection materializes.

export interface ConnectedAccountInfo {
  credentialId: string
  integrationId: string | null
  app: string
  label: string | null
  toolCount: number | null
}

export interface OpenConnectOptions {
  /** Pipedream app name_slug, e.g. "slack". */
  app: string
  onSuccess: (info: ConnectedAccountInfo) => void
  onError?: (message: string) => void
  /** Called when the user closes the auth dialog without connecting. */
  onCancel?: () => void
}

interface TokenResponse {
  token: string
  expiresAt: string | null
  connectLinkUrl: string | null
  externalUserId: string
}

interface AccountsResponse {
  accounts?: Array<{ credentialId: string; app: string | null; label: string | null }>
}

const POLL_INTERVAL_MS = 2_500
const POLL_MAX_MS = 5 * 60 * 1000

async function fetchAccounts(app: string, sync: boolean): Promise<AccountsResponse['accounts']> {
  const res = await fetch(
    `/api/pipedream/accounts?app=${encodeURIComponent(app)}${sync ? '&sync=1' : ''}`,
  )
  if (!res.ok) return []
  const body = (await res.json()) as AccountsResponse
  return body.accounts ?? []
}

/** Finalize a connection the SDK reported: verify + materialize server-side. */
async function completeConnection(
  accountId: string,
  app: string,
): Promise<{ info: ConnectedAccountInfo | null; error: string | null }> {
  const res = await fetch('/api/pipedream/connect/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId, app }),
  })
  const body = (await res.json().catch(() => ({}))) as {
    credentialId?: string
    integrationId?: string
    tools?: unknown[]
    accountLabel?: string | null
    error?: string
  }
  if (!res.ok || !body.credentialId) {
    return { info: null, error: body.error || `HTTP ${res.status}` }
  }
  return {
    info: {
      credentialId: body.credentialId,
      integrationId: body.integrationId ?? null,
      app,
      label: body.accountLabel ?? null,
      toolCount: Array.isArray(body.tools) ? body.tools.length : null,
    },
    error: null,
  }
}

/** Fallback: hosted Connect Link in a popup + poll until the account appears. */
async function connectViaLink(
  app: string,
  connectLinkUrl: string,
  opts: OpenConnectOptions,
): Promise<void> {
  const before = new Set(((await fetchAccounts(app, false)) ?? []).map((a) => a.credentialId))
  const popup = window.open(connectLinkUrl, 'pd-connect', 'width=520,height=720')
  if (!popup) {
    opts.onError?.(
      'Popup was blocked. Allow popups for this site, or open the connect link manually.',
    )
    return
  }
  const startedAt = Date.now()
  const poll = async (): Promise<void> => {
    if (Date.now() - startedAt > POLL_MAX_MS) {
      opts.onError?.('Timed out waiting for the connection to complete.')
      return
    }
    // sync=1 reconciles accounts completed upstream while this tab waited.
    const accounts = (await fetchAccounts(app, true)) ?? []
    const fresh = accounts.find((a) => !before.has(a.credentialId))
    if (fresh) {
      opts.onSuccess({
        credentialId: fresh.credentialId,
        integrationId: null,
        app,
        label: fresh.label,
        toolCount: null,
      })
      return
    }
    if (popup.closed) {
      // Give one grace re-check after close — the redirect may have landed
      // just before the user closed the window.
      const late = ((await fetchAccounts(app, true)) ?? []).find(
        (a) => !before.has(a.credentialId),
      )
      if (late) {
        opts.onSuccess({
          credentialId: late.credentialId,
          integrationId: null,
          app,
          label: late.label,
          toolCount: null,
        })
      } else {
        opts.onCancel?.()
      }
      return
    }
    setTimeout(() => void poll(), POLL_INTERVAL_MS)
  }
  setTimeout(() => void poll(), POLL_INTERVAL_MS)
}

/**
 * Open the Pipedream Connect auth flow for an app. Resolves immediately —
 * outcomes arrive via the callbacks.
 */
export async function openPipedreamConnect(opts: OpenConnectOptions): Promise<void> {
  const app = opts.app.trim().toLowerCase()
  if (!app) {
    opts.onError?.('No app specified.')
    return
  }
  let token: TokenResponse
  try {
    const res = await fetch('/api/pipedream/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app }),
    })
    const body = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string }
    if (!res.ok || !body.token) {
      opts.onError?.(body.error || 'Failed to start the connection flow.')
      return
    }
    token = body
  } catch {
    opts.onError?.('Failed to start the connection flow.')
    return
  }

  try {
    const { createFrontendClient } = await import('@pipedream/sdk/browser')
    const client = createFrontendClient({
      externalUserId: token.externalUserId,
      token: token.token,
      tokenCallback: async () => {
        const res = await fetch('/api/pipedream/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ app }),
        })
        const body = (await res.json()) as TokenResponse
        return {
          token: body.token,
          expiresAt: new Date(body.expiresAt ?? Date.now() + 3600_000),
          connectLinkUrl: body.connectLinkUrl ?? '',
        }
      },
    })
    let settled = false
    await client.connectAccount({
      app,
      token: token.token,
      onSuccess: (res) => {
        settled = true
        void completeConnection(res.id, app).then(({ info, error }) => {
          if (info) opts.onSuccess(info)
          else opts.onError?.(error || 'Failed to finalize the connection.')
        })
      },
      onError: (err) => {
        settled = true
        opts.onError?.(err.message || 'Connection failed.')
      },
      onClose: (status) => {
        if (!settled && !status.successful) opts.onCancel?.()
      },
    })
  } catch (err) {
    // SDK unavailable or iframe failed to boot — fall back to Connect Link.
    console.warn('[pipedream] SDK connect failed, falling back to Connect Link:', err)
    if (token.connectLinkUrl) {
      await connectViaLink(app, token.connectLinkUrl, opts)
    } else {
      opts.onError?.('Could not open the connection dialog.')
    }
  }
}
