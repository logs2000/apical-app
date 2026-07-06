// Async job layer — shared types + the pluggable backend interface.

export type JobBackendId = 'server' | 'desktop' | 'cloud'

/** Parsed Job.payloadJson. `env` is non-secret only — secrets stay in the
 *  vault and are never serialized into a job document. */
export interface JobPayload {
  language: 'javascript' | 'python' | 'shell'
  source: string
  packages?: string[]
  args?: string[]
  /** UserAsset ids staged into the job's working dir before it runs. */
  fileAssetIds?: string[]
  env?: Record<string, string>
}

/**
 * A backend gets a queued job "accepted" (claimed + started). It does NOT
 * return the result — execution reports progress/terminal state back through
 * the Job row (server: in-process; desktop: unsolicited socket push). This
 * keeps the DB the single source of truth across process/host boundaries.
 */
export interface JobBackend {
  id: JobBackendId
  /** Claim + begin executing the job. Throws to mark the job failed. */
  dispatch(jobId: string, workerId: string): Promise<void>
  /** Best-effort cancellation. */
  cancel(jobId: string): Promise<void>
}

export function parseJobPayload(raw: string | null | undefined): JobPayload {
  const fallback: JobPayload = { language: 'python', source: '' }
  if (!raw) return fallback
  try {
    return { ...fallback, ...(JSON.parse(raw) as Partial<JobPayload>) }
  } catch {
    return fallback
  }
}
