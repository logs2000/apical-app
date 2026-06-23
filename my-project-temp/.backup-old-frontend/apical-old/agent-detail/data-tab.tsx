'use client'

import * as React from 'react'
import { useAgentData } from '@/lib/queries'
import { useToast } from '@/hooks/use-toast'
import type { AgentDataRow, AgentDataKind, Workflow } from '@/lib/types'
import { cn } from '@/lib/utils'
import {
  FileText, Table2, Database, Download, Trash2, Plus,
  Loader2, KeyRound,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'

function EmptyState({ kind, label }: { kind: AgentDataKind; label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
      No {label} yet. The agent will populate these as it runs.
    </div>
  )
}

function OutputsList({ rows, onDelete }: { rows: AgentDataRow[]; onDelete: (key: string) => void }) {
  if (rows.length === 0) return <EmptyState kind="output" label="outputs" />
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{r.key}</div>
            {r.filePath && (
              <code className="truncate text-[10px] text-muted-foreground">{r.filePath}</code>
            )}
            {r.meta && r.meta.size !== undefined && (
              <span className="ml-2 text-[10px] text-muted-foreground">
                · {typeof r.meta.size === 'number' ? `${(r.meta.size / 1024).toFixed(1)} KB` : String(r.meta.size)}
              </span>
            )}
          </div>
          {r.filePath && (
            <Button size="sm" variant="ghost" className="h-7 text-xs">
              <Download className="mr-1 h-3 w-3" /> Download
            </Button>
          )}
          <Button
            size="sm" variant="ghost" className="h-7 text-xs text-destructive"
            onClick={() => onDelete(r.key)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  )
}

function TableList({ rows, onDelete }: { rows: AgentDataRow[]; onDelete: (key: string) => void }) {
  if (rows.length === 0) return <EmptyState kind="table" label="tables" />
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const tableData = r.value as { columns?: string[]; rows?: unknown[][] } | undefined
        const columns = tableData?.columns ?? []
        const tableRows = tableData?.rows ?? []
        return (
          <div key={r.id} className="rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
              <Table2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">{r.key}</span>
              <span className="text-[10px] text-muted-foreground">{tableRows.length} rows</span>
              <Button
                size="sm" variant="ghost" className="ml-auto h-6 text-xs text-destructive"
                onClick={() => onDelete(r.key)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            {columns.length > 0 && tableRows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-border">
                      {columns.map((c, i) => (
                        <th key={i} className="px-2 py-1 text-left font-medium text-muted-foreground">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.slice(0, 10).map((row, i) => (
                      <tr key={i} className="border-b border-border/40">
                        {row.map((cell, j) => (
                          <td key={j} className="px-2 py-1">{String(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {tableRows.length > 10 && (
                  <div className="px-2 py-1 text-[10px] text-muted-foreground">
                    + {tableRows.length - 10} more rows
                  </div>
                )}
              </div>
            ) : (
              <div className="px-3 py-3 text-[11px] text-muted-foreground">No rows yet.</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function StateList({ rows, onAdd, onDelete }: {
  rows: AgentDataRow[]
  onAdd: (key: string, value: string) => Promise<void>
  onDelete: (key: string) => void
}) {
  const [newKey, setNewKey] = React.useState('')
  const [newValue, setNewValue] = React.useState('')
  const [adding, setAdding] = React.useState(false)

  return (
    <div className="space-y-2">
      {rows.length === 0 && <EmptyState kind="state" label="state entries" />}
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
          <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <code className="min-w-0 flex-1 truncate text-xs font-medium">{r.key}</code>
          <code className="min-w-0 flex-[2] truncate text-[11px] text-muted-foreground">
            {typeof r.value === 'string' ? r.value : JSON.stringify(r.value)}
          </code>
          <Button
            size="sm" variant="ghost" className="h-6 text-xs text-destructive"
            onClick={() => onDelete(r.key)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}

      {/* Add new state */}
      <div className="rounded-lg border border-dashed border-border p-3">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <Plus className="h-3 w-3" /> Add state entry
        </div>
        <div className="flex gap-2">
          <Input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="key (e.g. last_run_id)"
            className="h-7 text-xs"
          />
          <Input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="value"
            className="h-7 text-xs"
          />
          <Button
            size="sm"
            disabled={!newKey.trim() || adding}
            onClick={async () => {
              setAdding(true)
              try {
                await onAdd(newKey.trim(), newValue)
                setNewKey('')
                setNewValue('')
              } finally {
                setAdding(false)
              }
            }}
          >
            {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function DataTab({ agent }: { agent: Workflow }) {
  const { data, refetch } = useAgentData(agent.id)
  const { toast } = useToast()

  const outputs = (data ?? []).filter((d) => d.kind === 'output')
  const tables = (data ?? []).filter((d) => d.kind === 'table')
  const states = (data ?? []).filter((d) => d.kind === 'state')

  // If the agent has no data at all, hide the tab (the parent checks this).
  const hasData = data && data.length > 0

  const deleteRow = async (kind: AgentDataKind, key: string) => {
    try {
      await fetch(`/api/agents/${agent.id}/data?kind=${kind}&key=${encodeURIComponent(key)}`, { method: 'DELETE' })
      refetch()
      toast({ title: 'Deleted' })
    } catch (e) {
      toast({ title: 'Failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const addState = async (key: string, value: string) => {
    try {
      await fetch(`/api/agents/${agent.id}/data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'state', key, value }),
      })
      refetch()
      toast({ title: 'State added' })
    } catch (e) {
      toast({ title: 'Failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <Database className="h-4 w-4 text-muted-foreground" /> Data
        </h2>
        <p className="text-[11px] text-muted-foreground">
          Files, tables, and state {agent.name} produces and accumulates.
        </p>
      </div>

      {!hasData && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <Database className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">No data yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            When {agent.name} runs and produces files, tables, or state, they&apos;ll show up here.
          </p>
        </div>
      )}

      {/* Outputs */}
      {outputs.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <FileText className="h-3 w-3" /> Outputs ({outputs.length})
          </h3>
          <OutputsList rows={outputs} onDelete={(k) => deleteRow('output', k)} />
        </div>
      )}

      {/* Tables */}
      {tables.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Table2 className="h-3 w-3" /> Tables ({tables.length})
          </h3>
          <TableList rows={tables} onDelete={(k) => deleteRow('table', k)} />
        </div>
      )}

      {/* State */}
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <KeyRound className="h-3 w-3" /> State {states.length > 0 && `(${states.length})`}
        </h3>
        <StateList
          rows={states}
          onAdd={addState}
          onDelete={(k) => deleteRow('state', k)}
        />
      </div>
    </div>
  )
}
