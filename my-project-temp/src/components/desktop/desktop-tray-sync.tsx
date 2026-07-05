'use client'

import * as React from 'react'
import {
  IS_TAURI,
  onTrayAction,
  updateTrayStatus,
  loadDesktopSettings,
  type TrayScheduledJob,
} from '@/lib/desktop/tauri-bridge'
import { getStoredDeviceToken } from '@/lib/desktop/device-flow'

interface SchedulerJobRow {
  id: string
  workflowId: string
  workflowName: string | null
  status: string
  nextRunAt: string
}

function formatNextRunLabel(nextRunAt: string, status: string): string {
  if (status === 'paused') return 'paused'
  const ms = new Date(nextRunAt).getTime() - Date.now()
  if (ms <= 0) return 'due now'
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `in ${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 48) return `in ${hrs}h`
  return new Date(nextRunAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function normalizeJobName(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function pickBetterJob(a: SchedulerJobRow, b: SchedulerJobRow): SchedulerJobRow {
  if (a.status !== b.status) return a.status === 'active' ? a : b
  return new Date(a.nextRunAt).getTime() <= new Date(b.nextRunAt).getTime() ? a : b
}

function toTrayJobs(rows: SchedulerJobRow[]): TrayScheduledJob[] {
  const candidates = rows.filter((j) => j.status === 'active' || j.status === 'paused')

  // One entry per workflow id (handles duplicate ScheduledJob rows).
  const byWorkflow = new Map<string, SchedulerJobRow>()
  for (const j of candidates) {
    const key = j.workflowId || j.id
    const prev = byWorkflow.get(key)
    byWorkflow.set(key, prev ? pickBetterJob(prev, j) : j)
  }

  // Also collapse legacy dupes: multiple workflows/jobs with the same display name.
  const byName = new Map<string, SchedulerJobRow>()
  for (const j of byWorkflow.values()) {
    const nameKey = normalizeJobName(j.workflowName) || j.workflowId || j.id
    const prev = byName.get(nameKey)
    byName.set(nameKey, prev ? pickBetterJob(prev, j) : j)
  }

  return Array.from(byName.values())
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1
      return new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime()
    })
    .slice(0, 12)
    .map((j) => ({
      id: j.id,
      name: j.workflowName?.trim() || 'Scheduled workflow',
      status: j.status,
      nextRunLabel: formatNextRunLabel(j.nextRunAt, j.status),
    }))
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getStoredDeviceToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * Keeps the native tray + menu bar in sync with scheduled workflows and wires
 * tray actions to scheduler APIs without opening the main window.
 */
export function DesktopTraySync() {
  React.useEffect(() => {
    if (!IS_TAURI) return

    let alive = true
    let poll: ReturnType<typeof setInterval> | null = null

    async function fetchJobs(): Promise<SchedulerJobRow[]> {
      try {
        const headers = await authHeaders()
        const res = await fetch('/api/scheduler/jobs', {
          headers,
          credentials: 'include',
        })
        if (!res.ok) return []
        return (await res.json()) as SchedulerJobRow[]
      } catch {
        return []
      }
    }

    async function refreshTray() {
      const settings = await loadDesktopSettings()
      const token = await getStoredDeviceToken()
      const linked = !!token && settings.deploymentMode !== 'local_only'

      let jobs: SchedulerJobRow[] = await fetchJobs()
      let automationsPaused = false
      let desktopOnline = false

      if (jobs.length > 0) {
        automationsPaused = jobs.every((j) => j.status === 'paused')
      }

      if (linked && token) {
        try {
          const sessRes = await fetch('/api/desktop/sessions', {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (sessRes.ok) {
            const data = (await sessRes.json()) as {
              sessions?: Array<{ status: string }>
            }
            desktopOnline = (data.sessions ?? []).some((s) => s.status === 'online')
          }
        } catch {
          /* cloud unreachable */
        }

        try {
          const local = await fetch('/api/desktop/local/cloud-link')
          if (local.ok) {
            const st = (await local.json()) as { status?: string }
            if (st.status === 'online') desktopOnline = true
          }
        } catch {
          /* ignore */
        }
      } else if (settings.deploymentMode === 'local_only') {
        desktopOnline = true
      }

      if (!alive) return
      const trayJobs = toTrayJobs(jobs)
      await updateTrayStatus({
        linked,
        desktopOnline,
        scheduledCount: trayJobs.filter((j) => j.status === 'active').length,
        automationsPaused,
        localOnly: settings.deploymentMode === 'local_only',
        jobs: trayJobs,
      })
    }

    async function handleJobAction(action: string, jobId: string) {
      const headers = {
        'Content-Type': 'application/json',
        ...(await authHeaders()),
      }
      if (action === 'run') {
        await fetch(`/api/scheduler/jobs/${jobId}/run`, {
          method: 'POST',
          headers,
          credentials: 'include',
        })
      } else if (action === 'pause') {
        await fetch(`/api/scheduler/jobs/${jobId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ status: 'paused' }),
          credentials: 'include',
        })
      } else if (action === 'resume') {
        await fetch(`/api/scheduler/jobs/${jobId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ status: 'active' }),
          credentials: 'include',
        })
      } else if (action === 'skip') {
        await fetch(`/api/scheduler/jobs/${jobId}/skip`, {
          method: 'POST',
          headers,
          credentials: 'include',
        })
      }
    }

    void refreshTray()
    poll = setInterval(() => void refreshTray(), 60_000)

    void onTrayAction(async (action) => {
      if (action === 'automations:toggle') {
        const token = await getStoredDeviceToken()
        if (!token) return
        try {
          const jobs = await fetchJobs()
          const allPaused = jobs.length > 0 && jobs.every((j) => j.status === 'paused')
          await fetch('/api/scheduler/jobs/pause-all', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ paused: !allPaused }),
            credentials: 'include',
          })
          void refreshTray()
        } catch {
          /* ignore */
        }
        return
      }

      if (typeof action === 'string' && action.startsWith('job:')) {
        const parts = action.split(':')
        if (parts.length >= 3) {
          const verb = parts[1]
          const jobId = parts.slice(2).join(':')
          try {
            await handleJobAction(verb, jobId)
            void refreshTray()
          } catch {
            /* ignore */
          }
        }
      }
    })

    return () => {
      alive = false
      if (poll) clearInterval(poll)
    }
  }, [])

  return null
}
