'use client'

import { useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import type { RunStepStatus, StepKind, RunReport } from '@/lib/types'

export interface LiveStepState {
  stepId: string
  kind: StepKind
  label: string
  order: number
  status: RunStepStatus
  message?: string
  output?: unknown
  aiTokens?: number
  aiCostCents?: number
}

export interface LiveRunState {
  status: 'idle' | 'running' | 'completed' | 'failed'
  steps: Record<string, LiveStepState>
  report?: RunReport
  stats?: {
    itemsProcessed: number
    automaticCount: number
    flaggedCount: number
    aiCallsUsed: number
    aiCallsSaved: number
    durationMs: number
  }
}

/**
 * Subscribes to a run's live execution events over the socket relay.
 * The browser connects to the relay (port 3003) via the gateway using XTransformPort.
 */
export function useRunSocket(runId: string | null) {
  const [state, setState] = useState<LiveRunState>({ status: 'idle', steps: {} })
  const [prevRunId, setPrevRunId] = useState<string | null>(runId)
  const socketRef = useRef<Socket | null>(null)

  // Adjust state when runId changes — the React-endorsed "adjusting state during
  // render" pattern (avoids synchronous setState inside an effect).
  if (runId !== prevRunId) {
    setPrevRunId(runId)
    setState({ status: runId ? 'running' : 'idle', steps: {} })
  }

  useEffect(() => {
    if (!runId) {
      socketRef.current = null
      return
    }

    const socket = io('/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 5,
      timeout: 10000,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      socket.emit('run:subscribe', { runId })
    })

    socket.on('run:started', (p: { runId: string }) => {
      if (p.runId !== runId) return
      setState((s) => ({ ...s, status: 'running' }))
    })

    socket.on('step:started', (p: { runId: string; stepId: string; kind: StepKind; label: string; order: number }) => {
      if (p.runId !== runId) return
      setState((s) => ({
        ...s,
        steps: {
          ...s.steps,
          [p.stepId]: { stepId: p.stepId, kind: p.kind, label: p.label, order: p.order, status: 'running' },
        },
      }))
    })

    socket.on('step:progress', (p: { runId: string; stepId: string; message: string }) => {
      if (p.runId !== runId) return
      setState((s) => {
        const prev = s.steps[p.stepId]
        if (!prev) return s
        return { ...s, steps: { ...s.steps, [p.stepId]: { ...prev, message: p.message } } }
      })
    })

    socket.on('step:completed', (p: { runId: string; stepId: string; status: RunStepStatus; output?: unknown; aiTokens?: number; aiCostCents?: number }) => {
      if (p.runId !== runId) return
      setState((s) => {
        const prev = s.steps[p.stepId]
        if (!prev) return s
        return {
          ...s,
          steps: {
            ...s.steps,
            [p.stepId]: { ...prev, status: p.status, output: p.output, aiTokens: p.aiTokens, aiCostCents: p.aiCostCents, message: undefined },
          },
        }
      })
    })

    socket.on('run:report', (p: { runId: string; report: RunReport; stats: LiveRunState['stats'] }) => {
      if (p.runId !== runId) return
      setState((s) => ({ ...s, report: p.report, stats: p.stats }))
    })

    socket.on('run:completed', (p: { runId: string; status: 'completed' | 'failed' }) => {
      if (p.runId !== runId) return
      setState((s) => ({ ...s, status: p.status }))
    })

    return () => {
      socket.emit('run:unsubscribe', { runId })
      socket.disconnect()
      socketRef.current = null
    }
  }, [runId])

  return state
}
