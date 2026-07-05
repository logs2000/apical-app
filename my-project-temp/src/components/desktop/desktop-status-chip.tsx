'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

interface DesktopSessionRow {
  id: string
  label: string
  status: string
  capabilitiesJson?: string
}

/** Shows whether the user's desktop is online and what remote access is enabled. */
export function DesktopStatusChip({ className }: { className?: string }) {
  const [sessions, setSessions] = React.useState<DesktopSessionRow[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch('/api/desktop/sessions')
        if (!res.ok) return
        const data = (await res.json()) as { sessions?: DesktopSessionRow[] }
        if (alive) setSessions(data.sessions ?? [])
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  if (loading) return null

  const online = sessions.find((s) => s.status === 'online')
  if (!online) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground',
          className,
        )}
      >
        Desktop offline — local scheduled workflows will skip
      </span>
    )
  }

  let caps: string[] = []
  try {
    const parsed = JSON.parse(online.capabilitiesJson || '[]')
    if (Array.isArray(parsed)) caps = parsed.filter((v) => typeof v === 'string')
  } catch {
    caps = []
  }

  const fsCap = caps.find((c) => c.startsWith('fs:'))
  const fsLabel = fsCap === 'fs:read_write' ? 'remote file R/W' : fsCap === 'fs:read_only' ? 'remote file read-only' : 'remote file off'

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-900 dark:text-emerald-100',
        className,
      )}
    >
      Desktop online ({online.label}) · {fsLabel}
    </span>
  )
}
