'use client'

import * as React from 'react'
import { useRunWorkflow, useRun, useCancelRun } from '@/lib/queries'
import { useRunSocket } from '@/hooks/use-run-socket'

export type WorkflowRunOutcome = 'completed' | 'failed' | 'cancelled' | null

export function useWorkflowRun(workflowId: string) {
  const runWorkflow = useRunWorkflow()
  const cancelRun = useCancelRun()
  const [activeRunId, setActiveRunId] = React.useState<string | null>(null)
  const [lastOutcome, setLastOutcome] = React.useState<WorkflowRunOutcome>(null)
  const [startError, setStartError] = React.useState<string | null>(null)

  const live = useRunSocket(activeRunId)
  const { data: polledRun } = useRun(activeRunId)

  const terminalFromPoll =
    polledRun?.status === 'completed' ||
    polledRun?.status === 'failed' ||
    polledRun?.status === 'cancelled'
      ? polledRun.status
      : null

  const liveTerminal =
    live.status === 'completed' || live.status === 'failed' || live.status === 'cancelled'
      ? live.status
      : null

  const isReviewing = !!activeRunId && live.status === 'reviewing' && !liveTerminal && !terminalFromPoll

  const isRunning =
    !!activeRunId &&
    !liveTerminal &&
    !terminalFromPoll &&
    (live.status === 'running' ||
      live.status === 'reviewing' ||
      polledRun?.status === 'running' ||
      runWorkflow.isPending)

  React.useEffect(() => {
    const outcome = liveTerminal ?? terminalFromPoll
    if (!outcome || !activeRunId) return
    setLastOutcome(outcome)
    setActiveRunId(null)
  }, [liveTerminal, terminalFromPoll, activeRunId])

  React.useEffect(() => {
    if (!lastOutcome) return
    const t = window.setTimeout(() => setLastOutcome(null), 8000)
    return () => window.clearTimeout(t)
  }, [lastOutcome])

  async function startRun() {
    setStartError(null)
    setLastOutcome(null)
    try {
      const { runId } = await runWorkflow.mutateAsync({ id: workflowId, trigger: 'manual' })
      setActiveRunId(runId)
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Failed to start run')
    }
  }

  async function stopRun() {
    if (!activeRunId) return
    try {
      await cancelRun.mutateAsync(activeRunId)
      setLastOutcome('cancelled')
      setActiveRunId(null)
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Failed to stop run')
    }
  }

  return {
    startRun,
    stopRun,
    isRunning,
    isReviewing,
    isStarting: runWorkflow.isPending,
    isStopping: cancelRun.isPending,
    activeRunId,
    lastOutcome,
    startError,
    live,
    polledRun,
  }
}
