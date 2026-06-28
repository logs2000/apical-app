/** True when text is a failed-send / missing-model message (not a real reply). */
export function isSendError(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return (
    /something went wrong/i.test(t) ||
    /no llm provider configured/i.test(t) ||
    /no ai model (available|connected)/i.test(t) ||
    /couldn't reach the assistant/i.test(t) ||
    /couldn't run the autonomous loop/i.test(t) ||
    /check that an llm provider is configured/i.test(t) ||
    /openai_api_key/i.test(t) ||
    /ap_pat_/i.test(t) ||
    /couldn't produce a response/i.test(t) ||
    /no response from the assistant/i.test(t)
  )
}

/** Whether the user can use Retry for this error (transient / network / rate limit). */
export function isRetryableSendError(message: string): boolean {
  const m = message.toLowerCase()
  if (
    /no ai model|no llm provider|open settings|ap_pat_|sign in again|session expired|not configured/i.test(
      m,
    )
  ) {
    return false
  }
  return (
    /try again|temporarily|rate limit|503|502|504|network|fetch|timeout|connection|went wrong|couldn't reach|no response|unavailable/i.test(
      m,
    )
  )
}

export function formatSendError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  // Strip our internal prefix and any raw provider payload (JSON body, request
  // ids, URLs) so we never surface raw error codes / stack-ish text to users.
  const msg = raw
    .replace(/^LLM call failed:\s*/i, "")
    .replace(/\s*\{[\s\S]*$/, "") // drop trailing JSON error body (often truncated)
    .replace(/\s*req_[A-Za-z0-9]+/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\s:–—-]+$/, "")
    .trim()

  if (/^unauthorized$/i.test(msg) || /\b(401|403)\b/.test(msg) || /session expired|sign in again/i.test(msg)) {
    return "Your session expired. Restart the app or sign in again from Settings."
  }
  if (
    /\b503\b|upstream connect error|connection termination|reset before headers|temporarily unavailable|overloaded/i.test(
      msg,
    )
  ) {
    return "The AI provider is temporarily unavailable. Try again in a moment."
  }
  if (/\b429\b|rate.?limit/i.test(msg)) {
    return "Rate limit reached. Wait a moment and try again."
  }
  if (/\b5\d\d\b/.test(msg)) {
    return "The AI provider hit a server error. Try again shortly."
  }
  if (/\b400\b|invalid_request|bad request/i.test(msg)) {
    return "That request couldn't be processed. Please try again."
  }
  if (isSendError(msg)) {
    return "No AI model connected. Open Settings → Models and add your Apical token (ap_pat_…)."
  }
  if (/network|fetch failed|econnrefused|enotfound|timed? ?out|aborted|socket/i.test(msg)) {
    return "Couldn't reach the AI provider. Check your connection and try again."
  }
  // Final guard: anything that still looks like a raw technical error (status
  // codes, "stream N", provider/SDK noise, or an over-long blob) is replaced
  // with a clean generic message.
  if (
    !msg ||
    msg.length > 160 ||
    /\b\d{3}\b|stream \d|api \d|error[:\s]|exception|\bat \w+\./i.test(msg)
  ) {
    return "Something went wrong. Try again."
  }
  return msg
}
