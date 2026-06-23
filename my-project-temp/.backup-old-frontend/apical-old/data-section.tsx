'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  Database,
  Plus,
  Trash2,
  Pencil,
  Table as TableIcon,
  Loader2,
  Plug,
  Unplug,
  CheckCircle2,
  XCircle,
  Download,
  ChevronLeft,
  ChevronRight,
  Search,
  Sparkles,
  ExternalLink,
} from 'lucide-react'

// ---------------- Types ----------------

type ColumnType = 'string' | 'number' | 'boolean' | 'date' | 'json'

interface ColumnDef2 {
  name: string
  type: ColumnType
  required?: boolean
}

interface TableDTO {
  id: string
  userId: string
  name: string
  description: string
  columns: ColumnDef2[]
  sourceWorkflowId: string | null
  rowCount: number
  createdAt: string
  updatedAt: string
}

interface RowDTO {
  id: string
  tableId: string
  data: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

interface TableDetailDTO {
  table: TableDTO
  rows: RowDTO[]
  total: number
  limit: number
  offset: number
}

type ConfigFieldType = 'text' | 'password' | 'number' | 'url'

interface PluginConfigFieldDTO {
  key: string
  label: string
  type: ConfigFieldType
  placeholder?: string
  required: boolean
  secret: boolean
  help?: string
  defaultValue?: string | number
}

interface PluginDTO {
  kind: string
  name: string
  icon: string
  description: string
  category: 'sql' | 'nosql' | 'sheets' | 'notes'
  configFields: PluginConfigFieldDTO[]
}

interface ConnectionDTO {
  id: string
  userId: string
  kind: string
  name: string
  config: Record<string, unknown>
  meta: Record<string, unknown>
  status: string
  lastStatus: string | null
  lastCheckedAt: string | null
  createdAt: string
  updatedAt: string
}

// ---------------- Helpers ----------------

async function j<T>(res: Promise<Response>): Promise<T> {
  const r = await res
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(e.error || `Request failed: ${r.status}`)
  }
  return r.json() as Promise<T>
}

const COLUMN_TYPE_OPTIONS: { value: ColumnType; label: string }[] = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'date', label: 'Date (ISO)' },
  { value: 'json', label: 'JSON' },
]

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'never'
  const d = new Date(iso).getTime()
  const diff = Date.now() - d
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return formatDate(iso)
}

// ---------------- Main component ----------------

export function DataSection() {
  const [tab, setTab] = React.useState<'tables' | 'connections'>('tables')
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">Data</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Built-in tables for stashing scraped leads, device inventories, and compliance
          calendars — plus connect external stores so agents can query them.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'tables' | 'connections')}>
        <TabsList>
          <TabsTrigger value="tables" className="text-xs">
            <TableIcon className="mr-1 h-3.5 w-3.5" /> Tables
          </TabsTrigger>
          <TabsTrigger value="connections" className="text-xs">
            <Plug className="mr-1 h-3.5 w-3.5" /> Connections
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tables" className="outline-none">
          <TablesTab />
        </TabsContent>
        <TabsContent value="connections" className="outline-none">
          <ConnectionsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default DataSection

// ---------------- Tables tab ----------------

function TablesTab() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data: tables, isLoading } = useQuery<TableDTO[]>({
    queryKey: ['data-tables'],
    queryFn: () => j(fetch('/api/tables').then((r) => r)),
  })
  const [openTableId, setOpenTableId] = React.useState<string | null>(null)
  const [newOpen, setNewOpen] = React.useState(false)

  const deleteTable = useMutation({
    mutationFn: (id: string) =>
      j(
        fetch(`/api/tables/${id}`, { method: 'DELETE' }).then((r) => r),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['data-tables'] })
      toast({ title: 'Table deleted' })
    },
    onError: (e: Error) =>
      toast({
        title: 'Could not delete',
        description: e.message,
        variant: 'destructive',
      }),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {tables?.length ?? 0} table{(tables?.length ?? 0) === 1 ? '' : 's'}
        </p>
        <Button size="sm" onClick={() => setNewOpen(true)} className="h-7 text-xs">
          <Plus className="mr-1 h-3 w-3" /> New table
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : !tables || tables.length === 0 ? (
        <TablesEmptyState
          onCreate={() => setNewOpen(true)}
        />
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {tables.map((t, i) => (
            <TableCard
              key={t.id}
              table={t}
              delay={i * 0.04}
              onOpen={() => setOpenTableId(t.id)}
              onDelete={() => deleteTable.mutate(t.id)}
              deleting={deleteTable.isPending}
            />
          ))}
        </motion.div>
      )}

      <NewTableDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={() => qc.invalidateQueries({ queryKey: ['data-tables'] })}
      />

      {openTableId && (
        <TableDetailSheet
          tableId={openTableId}
          onOpenChange={(o) => !o && setOpenTableId(null)}
        />
      )}
    </div>
  )
}

function TablesEmptyState({ onCreate }: { onCreate: () => void }) {
  const examples = [
    {
      icon: '🎯',
      name: 'Leads',
      desc: 'Scraped company contacts with a fit score.',
      cols: ['company', 'contact', 'email', 'score'],
    },
    {
      icon: '💻',
      name: 'Devices',
      desc: 'Inventory of laptops, phones, and accessories.',
      cols: ['asset_tag', 'model', 'assigned_to', 'warranty_until'],
    },
    {
      icon: '📅',
      name: 'Compliance calendar',
      desc: 'Recurring filings + deadlines agents must track.',
      cols: ['filing', 'due_date', 'jurisdiction', 'status'],
    },
  ]
  return (
    <div className="rounded-xl border border-dashed border-border p-6 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Database className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-medium">No tables yet</h3>
      <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
        Agents create tables to stash structured output — scraped leads, device
        inventories, compliance calendars. Create one yourself to seed the agent
        with a known shape.
      </p>
      <Button onClick={onCreate} size="sm" className="mt-3 h-7 text-xs">
        <Plus className="mr-1 h-3 w-3" /> Create a table
      </Button>

      <div className="mt-5 grid grid-cols-1 gap-2 text-left sm:grid-cols-3">
        {examples.map((e) => (
          <div
            key={e.name}
            className="rounded-lg border border-border bg-card p-2.5"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-base">{e.icon}</span>
              <span className="text-xs font-medium">{e.name}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{e.desc}</div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {e.cols.map((c) => (
                <span
                  key={c}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TableCard({
  table,
  delay,
  onOpen,
  onDelete,
  deleting,
}: {
  table: TableDTO
  delay: number
  onOpen: () => void
  onDelete: () => void
  deleting: boolean
}) {
  const [confirm, setConfirm] = React.useState(false)
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.2 }}
      className="group relative flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-primary/40"
    >
      <button
        onClick={onOpen}
        className="flex-1 space-y-2 text-left"
        aria-label={`Open table ${table.name}`}
      >
        <div className="flex items-start gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <TableIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{table.name}</div>
            {table.description ? (
              <div className="line-clamp-2 text-[11px] text-muted-foreground">
                {table.description}
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground/60">No description</div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            {table.rowCount} row{table.rowCount === 1 ? '' : 's'}
          </Badge>
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            {table.columns.length} col{table.columns.length === 1 ? '' : 's'}
          </Badge>
          <span className="ml-auto text-[10px] text-muted-foreground/60">
            {formatDate(table.createdAt)}
          </span>
        </div>
      </button>

      <div className="flex items-center justify-between border-t border-border/60 pt-2">
        <span className="truncate font-mono text-[9px] text-muted-foreground/70">
          {table.columns.map((c) => c.name).slice(0, 4).join(' · ') || '—'}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setConfirm(true)}
          disabled={deleting}
          className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-destructive"
          aria-label="Delete table"
        >
          {deleting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Trash2 className="h-3 w-3" />
          )}
        </Button>
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{table.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              All {table.rowCount} row{table.rowCount === 1 ? '' : 's'} will be deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirm(false)
                onDelete()
              }}
              className="bg-destructive text-white hover:bg-destructive/90 text-xs"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  )
}

// ---------------- New table dialog ----------------

function NewTableDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: () => void
}) {
  const { toast } = useToast()
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [cols, setCols] = React.useState<ColumnDef2[]>([
    { name: '', type: 'string', required: false },
  ])

  const createMut = useMutation({
    mutationFn: (input: {
      name: string
      description?: string
      columns: ColumnDef2[]
    }) =>
      j<TableDTO>(
        fetch('/api/tables', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }).then((r) => r),
      ),
    onSuccess: () => {
      onCreated()
      toast({ title: 'Table created' })
      // Reset form.
      setName('')
      setDescription('')
      setCols([{ name: '', type: 'string', required: false }])
      onOpenChange(false)
    },
    onError: (e: Error) =>
      toast({
        title: 'Could not create table',
        description: e.message,
        variant: 'destructive',
      }),
  })

  const valid =
    name.trim().length > 0 &&
    cols.length > 0 &&
    cols.every((c) => c.name.trim().length > 0) &&
    new Set(cols.map((c) => c.name.trim())).size === cols.length

  const submit = () => {
    if (!valid) return
    createMut.mutate({
      name: name.trim(),
      description: description.trim(),
      columns: cols.map((c) => ({
        name: c.name.trim(),
        type: c.type,
        required: c.required,
      })),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <TableIcon className="h-4 w-4 text-primary" /> New table
          </DialogTitle>
          <DialogDescription className="text-xs">
            Define a schema; agents and workflows will write rows that match it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div>
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Leads"
              className="text-sm"
              autoFocus
            />
          </div>
          <div>
            <Label className="text-xs">Description (optional)</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this table holds"
              className="text-sm"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label className="text-xs">Columns</Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                onClick={() =>
                  setCols((cs) => [
                    ...cs,
                    { name: '', type: 'string', required: false },
                  ])
                }
              >
                <Plus className="mr-1 h-3 w-3" /> Add column
              </Button>
            </div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {cols.map((c, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[1fr_110px_auto_auto] items-center gap-1.5"
                >
                  <Input
                    value={c.name}
                    onChange={(e) =>
                      setCols((cs) =>
                        cs.map((cc, i) =>
                          i === idx ? { ...cc, name: e.target.value } : cc,
                        ),
                      )
                    }
                    placeholder="column_name"
                    className="h-8 text-xs font-mono"
                  />
                  <Select
                    value={c.type}
                    onValueChange={(v) =>
                      setCols((cs) =>
                        cs.map((cc, i) =>
                          i === idx ? { ...cc, type: v as ColumnType } : cc,
                        ),
                      )
                    }
                  >
                    <SelectTrigger size="sm" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COLUMN_TYPE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value} className="text-xs">
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    onClick={() =>
                      setCols((cs) =>
                        cs.map((cc, i) =>
                          i === idx ? { ...cc, required: !cc.required } : cc,
                        ),
                      )
                    }
                    className={cn(
                      'flex h-8 items-center rounded-md border px-2 text-[10px] transition-colors',
                      c.required
                        ? 'border-primary/40 bg-primary/5 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/30',
                    )}
                    aria-pressed={c.required}
                    title="Toggle required"
                  >
                    req
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setCols((cs) => cs.filter((_, i) => i !== idx))
                    }
                    disabled={cols.length === 1}
                    className="flex h-8 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-destructive disabled:opacity-40"
                    aria-label="Remove column"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="text-xs">
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={!valid || createMut.isPending} className="text-xs">
            {createMut.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Plus className="mr-1 h-3 w-3" />
            )}
            Create table
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------- Table detail sheet ----------------

function TableDetailSheet({
  tableId,
  onOpenChange,
}: {
  tableId: string
  onOpenChange: (o: boolean) => void
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [offset, setOffset] = React.useState(0)
  const limit = 25
  const [where, setWhere] = React.useState('')

  const { data, isLoading, refetch, isFetching } = useQuery<TableDetailDTO>({
    queryKey: ['data-table', tableId, offset, where],
    queryFn: () => {
      const u = new URL(`/api/tables/${tableId}/rows`, window.location.origin)
      u.searchParams.set('limit', String(limit))
      u.searchParams.set('offset', String(offset))
      if (where.trim()) u.searchParams.set('where', where.trim())
      return j(fetch(u.toString().replace(window.location.origin, '')).then((r) => r))
    },
  })

  const [addOpen, setAddOpen] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)
  const [editRow, setEditRow] = React.useState<RowDTO | null>(null)

  const totalPages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1
  const page = Math.floor(offset / limit) + 1

  const columns = data?.table.columns ?? []
  const rows = data?.rows ?? []

  // Build the react-table columns: one per schema column + a controls column.
  const tableCols = React.useMemo<ColumnDef<RowDTO>[]>(() => {
    const out: ColumnDef<RowDTO>[] = columns.map((c) => ({
      id: c.name,
      accessorKey: 'data',
      header: () => (
        <div className="flex items-center gap-1">
          <span className="text-[11px] font-medium">{c.name}</span>
          {c.required && (
            <span className="text-primary" title="required">
              *
            </span>
          )}
          <span className="rounded bg-muted px-1 font-mono text-[9px] text-muted-foreground">
            {c.type}
          </span>
        </div>
      ),
      cell: ({ row }) => {
        const v = (row.original.data as Record<string, unknown>)[c.name]
        return <CellRenderer value={v} type={c.type} />
      },
    }))
    out.push({
      id: '_actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => setEditRow(row.original)}
            aria-label="Edit row"
          >
            <Pencil className="h-3 w-3" />
          </Button>
          <DeleteRowButton
            tableId={tableId}
            rowId={row.original.id}
            onDeleted={() => refetch()}
          />
        </div>
      ),
    })
    return out
  }, [columns, tableId, refetch])

  const table = useReactTable({
    data: rows,
    columns: tableCols,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-3xl flex flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <TableIcon className="h-4 w-4 text-primary" />
            <SheetTitle className="text-base">{data?.table.name ?? 'Loading…'}</SheetTitle>
            {data && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                {data.total} row{data.total === 1 ? '' : 's'}
              </Badge>
            )}
          </div>
          {data?.table.description && (
            <SheetDescription className="text-xs">
              {data.table.description}
            </SheetDescription>
          )}
        </SheetHeader>

        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={where}
              onChange={(e) => {
                setWhere(e.target.value)
                setOffset(0)
              }}
              placeholder='Filter: {"status":"open"}'
              className="h-7 pl-7 font-mono text-[11px]"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={() => setImportOpen(true)}
          >
            <Download className="mr-1 h-3 w-3" /> Import JSON
          </Button>
          <Button size="sm" className="h-7 text-[11px]" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 h-3 w-3" /> Add row
          </Button>
        </div>

        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="space-y-1 p-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              {where.trim()
                ? 'No rows match this filter.'
                : 'No rows yet. Add one or import JSON.'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((h) => (
                      <TableHead key={h.id} className="h-8 px-2 text-[11px]">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((r) => (
                  <TableRow key={r.id} className="text-xs">
                    {r.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="px-2 py-1.5 align-top">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Pagination footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-2">
          <span className="text-[10px] text-muted-foreground">
            {isFetching ? 'Loading…' : `Page ${page} of ${totalPages}`}
          </span>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-7 p-0"
              disabled={offset === 0}
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-7 p-0"
              disabled={!data || offset + limit >= data.total}
              onClick={() => setOffset((o) => o + limit)}
              aria-label="Next page"
            >
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </SheetContent>

      {data && (
        <RowEditDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          tableId={tableId}
          columns={columns}
          row={null}
          onSaved={() => {
            setAddOpen(false)
            refetch()
            qc.invalidateQueries({ queryKey: ['data-tables'] })
          }}
        />
      )}
      {data && (
        <RowEditDialog
          open={!!editRow}
          onOpenChange={(o) => !o && setEditRow(null)}
          tableId={tableId}
          columns={columns}
          row={editRow}
          onSaved={() => {
            setEditRow(null)
            refetch()
            qc.invalidateQueries({ queryKey: ['data-tables'] })
          }}
        />
      )}
      {data && (
        <ImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          tableId={tableId}
          columns={columns}
          onImported={() => {
            setImportOpen(false)
            refetch()
            qc.invalidateQueries({ queryKey: ['data-tables'] })
          }}
        />
      )}
    </Sheet>
  )
}

// ---------------- Cell renderer ----------------

function CellRenderer({ value, type }: { value: unknown; type: ColumnType }) {
  if (value === undefined || value === null) {
    return <span className="text-muted-foreground/40">—</span>
  }
  if (type === 'boolean') {
    const b = value === true || value === 'true'
    return b ? (
      <Badge
        variant="outline"
        className="border-primary/30 bg-primary/5 text-[9px] text-primary"
      >
        true
      </Badge>
    ) : (
      <Badge variant="outline" className="text-[9px] text-muted-foreground">
        false
      </Badge>
    )
  }
  if (type === 'json' && typeof value === 'object') {
    return (
      <span className="block max-w-[260px] truncate font-mono text-[10px] text-muted-foreground">
        {JSON.stringify(value)}
      </span>
    )
  }
  if (type === 'number') {
    return <span className="font-mono text-[11px]">{String(value)}</span>
  }
  if (type === 'date') {
    return <span className="text-[11px]">{formatDate(String(value))}</span>
  }
  return <span className="text-[11px]">{String(value)}</span>
}

// ---------------- Delete row button ----------------

function DeleteRowButton({
  tableId,
  rowId,
  onDeleted,
}: {
  tableId: string
  rowId: string
  onDeleted: () => void
}) {
  const { toast } = useToast()
  const mut = useMutation({
    mutationFn: () =>
      j(
        fetch(`/api/tables/${tableId}/rows/${rowId}`, {
          method: 'DELETE',
        }).then((r) => r),
      ),
    onSuccess: () => {
      onDeleted()
      toast({ title: 'Row deleted' })
    },
    onError: (e: Error) =>
      toast({
        title: 'Could not delete',
        description: e.message,
        variant: 'destructive',
      }),
  })
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
      onClick={() => mut.mutate()}
      disabled={mut.isPending}
      aria-label="Delete row"
    >
      {mut.isPending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Trash2 className="h-3 w-3" />
      )}
    </Button>
  )
}

// ---------------- Row edit dialog (add + edit) ----------------

function RowEditDialog({
  open,
  onOpenChange,
  tableId,
  columns,
  row,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  tableId: string
  columns: ColumnDef2[]
  row: RowDTO | null
  onSaved: () => void
}) {
  const { toast } = useToast()
  const isEdit = !!row
  const [values, setValues] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    if (open) {
      const init: Record<string, string> = {}
      const src = row?.data ?? {}
      for (const c of columns) {
        const v = src[c.name]
        init[c.name] =
          v === undefined || v === null
            ? ''
            : typeof v === 'object'
              ? JSON.stringify(v)
              : String(v)
      }
      setValues(init)
    }
  }, [open, row, columns])

  const mut = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {}
      for (const c of columns) {
        const raw = (values[c.name] ?? '').trim()
        if (raw === '') continue
        if (c.type === 'number') body[c.name] = Number(raw)
        else if (c.type === 'boolean') body[c.name] = raw === 'true'
        else if (c.type === 'json') {
          try {
            body[c.name] = JSON.parse(raw)
          } catch {
            body[c.name] = raw
          }
        } else body[c.name] = raw
      }
      if (isEdit && row) {
        return j(
          fetch(`/api/tables/${tableId}/rows/${row.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ row: body }),
          }).then((r) => r),
        )
      }
      return j(
        fetch(`/api/tables/${tableId}/rows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ row: body }),
        }).then((r) => r),
      )
    },
    onSuccess: () => {
      toast({ title: isEdit ? 'Row updated' : 'Row added' })
      onSaved()
    },
    onError: (e: Error) =>
      toast({
        title: 'Save failed',
        description: e.message,
        variant: 'destructive',
      }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">
            {isEdit ? 'Edit row' : 'Add row'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Fill in the fields. Required ones are marked with <span className="text-primary">*</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-2 overflow-y-auto py-1 pr-1">
          {columns.map((c) => (
            <div key={c.name}>
              <Label className="text-xs">
                {c.name}
                {c.required && <span className="ml-0.5 text-primary">*</span>}
                <span className="ml-1.5 rounded bg-muted px-1 font-mono text-[9px] text-muted-foreground">
                  {c.type}
                </span>
              </Label>
              {c.type === 'boolean' ? (
                <Select
                  value={values[c.name] || 'false'}
                  onValueChange={(v) =>
                    setValues((s) => ({ ...s, [c.name]: v }))
                  }
                >
                  <SelectTrigger size="sm" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true" className="text-xs">
                      true
                    </SelectItem>
                    <SelectItem value="false" className="text-xs">
                      false
                    </SelectItem>
                  </SelectContent>
                </Select>
              ) : c.type === 'json' ? (
                <Textarea
                  value={values[c.name] ?? ''}
                  onChange={(e) =>
                    setValues((s) => ({ ...s, [c.name]: e.target.value }))
                  }
                  placeholder='{"key":"value"}'
                  className="font-mono text-[11px]"
                  rows={3}
                />
              ) : (
                <Input
                  value={values[c.name] ?? ''}
                  onChange={(e) =>
                    setValues((s) => ({ ...s, [c.name]: e.target.value }))
                  }
                  placeholder={
                    c.type === 'date' ? '2025-01-31' : c.name
                  }
                  className="h-8 text-xs"
                  type={c.type === 'number' ? 'number' : 'text'}
                />
              )}
            </div>
          ))}
          {columns.length === 0 && (
            <p className="text-xs text-muted-foreground">
              This table has no columns defined.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="text-xs">
            Cancel
          </Button>
          <Button size="sm" onClick={() => mut.mutate()} disabled={mut.isPending} className="text-xs">
            {mut.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : isEdit ? (
              <Pencil className="mr-1 h-3 w-3" />
            ) : (
              <Plus className="mr-1 h-3 w-3" />
            )}
            {isEdit ? 'Save' : 'Add row'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------- Import JSON dialog ----------------

function ImportDialog({
  open,
  onOpenChange,
  tableId,
  columns,
  onImported,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  tableId: string
  columns: ColumnDef2[]
  onImported: () => void
}) {
  const { toast } = useToast()
  const [text, setText] = React.useState('')

  React.useEffect(() => {
    if (open) {
      const sample = columns
        .slice(0, 2)
        .map((c) =>
          c.type === 'number'
            ? 0
            : c.type === 'boolean'
              ? false
              : c.type === 'json'
                ? {}
                : '',
        )
      const obj: Record<string, unknown> = {}
      columns.slice(0, 2).forEach((c, i) => {
        obj[c.name] = sample[i]
      })
      setText(JSON.stringify([obj], null, 2))
    }
  }, [open, columns])

  const mut = useMutation({
    mutationFn: async () => {
      let rows: unknown
      try {
        rows = JSON.parse(text)
      } catch (e) {
        throw new Error(
          `Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`,
        )
      }
      if (!Array.isArray(rows)) {
        throw new Error('Top-level value must be an array of objects')
      }
      return j<{ inserted: number; total: number }>(
        fetch(`/api/tables/${tableId}/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows }),
        }).then((r) => r),
      )
    },
    onSuccess: (res) => {
      toast({
        title: 'Imported',
        description: `${res.inserted} of ${res.total} row${res.total === 1 ? '' : 's'} added.`,
      })
      onImported()
    },
    onError: (e: Error) =>
      toast({
        title: 'Import failed',
        description: e.message,
        variant: 'destructive',
      }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Import rows as JSON</DialogTitle>
          <DialogDescription className="text-xs">
            Paste an array of row objects. Schema:{' '}
            <code className="font-mono">
              {columns.map((c) => c.name).join(', ') || '—'}
            </code>
            . Max 1000 rows.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          className="font-mono text-[11px]"
          spellCheck={false}
        />

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="text-xs">
            Cancel
          </Button>
          <Button size="sm" onClick={() => mut.mutate()} disabled={mut.isPending} className="text-xs">
            {mut.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Download className="mr-1 h-3 w-3" />
            )}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------- Connections tab ----------------

const CATEGORY_ORDER = ['sql', 'nosql', 'sheets', 'notes'] as const
const CATEGORY_LABELS: Record<string, string> = {
  sql: 'SQL databases',
  nosql: 'NoSQL / low-code',
  sheets: 'Spreadsheets',
  notes: 'Notes & docs',
}

function ConnectionsTab() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<{
    connections: ConnectionDTO[]
    plugins: PluginDTO[]
  }>({
    queryKey: ['data-connections'],
    queryFn: () => j(fetch('/api/data-connections').then((r) => r)),
  })

  const [connectPlugin, setConnectPlugin] = React.useState<PluginDTO | null>(null)
  const plugins = data?.plugins ?? []
  const connections = data?.connections ?? []

  const grouped = React.useMemo(() => {
    const map = new Map<string, PluginDTO[]>()
    for (const p of plugins) {
      const arr = map.get(p.category) ?? []
      arr.push(p)
      map.set(p.category, arr)
    }
    const sorted: Array<{ category: string; items: PluginDTO[] }> = []
    for (const cat of CATEGORY_ORDER) {
      const items = map.get(cat)
      if (items && items.length) sorted.push({ category: cat, items })
    }
    for (const [cat, items] of map.entries()) {
      if (!CATEGORY_ORDER.includes(cat as (typeof CATEGORY_ORDER)[number])) {
        sorted.push({ category: cat, items })
      }
    }
    return sorted
  }, [plugins])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="text-xs text-muted-foreground">
          {connections.length} active connection{connections.length === 1 ? '' : 's'}.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map((group, gi) => (
            <motion.div
              key={group.category}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: gi * 0.04, duration: 0.2 }}
              className="space-y-2"
            >
              <div className="flex items-center gap-2 px-0.5">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {CATEGORY_LABELS[group.category] ?? group.category}
                </h3>
                <span className="text-[10px] text-muted-foreground/70">
                  {group.items.length}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((p, i) => {
                  const conn = connections.find((c) => c.kind === p.kind)
                  return (
                    <ConnectionCard
                      key={p.kind}
                      plugin={p}
                      connection={conn ?? null}
                      delay={gi * 0.04 + i * 0.02}
                      onConnect={() => setConnectPlugin(p)}
                      onChanged={() =>
                        qc.invalidateQueries({ queryKey: ['data-connections'] })
                      }
                    />
                  )
                })}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {connectPlugin && (
        <ConnectDialog
          plugin={connectPlugin}
          onOpenChange={(o) => !o && setConnectPlugin(null)}
          onConnected={() => {
            setConnectPlugin(null)
            qc.invalidateQueries({ queryKey: ['data-connections'] })
          }}
        />
      )}
    </div>
  )
}

function ConnectionCard({
  plugin,
  connection,
  delay,
  onConnect,
  onChanged,
}: {
  plugin: PluginDTO
  connection: ConnectionDTO | null
  delay: number
  onConnect: () => void
  onChanged: () => void
}) {
  const { toast } = useToast()
  const [testing, setTesting] = React.useState(false)

  const disconnect = useMutation({
    mutationFn: () =>
      j(
        fetch(`/api/data-connections/${connection!.id}`, {
          method: 'DELETE',
        }).then((r) => r),
      ),
    onSuccess: () => {
      onChanged()
      toast({ title: `${plugin.name} disconnected` })
    },
    onError: (e: Error) =>
      toast({
        title: 'Could not disconnect',
        description: e.message,
        variant: 'destructive',
      }),
  })

  const test = async () => {
    if (!connection) return
    setTesting(true)
    try {
      const res = await j<{ ok: boolean; detail: string; tables?: string[] }>(
        fetch(`/api/data-connections/${connection.id}/test`, {
          method: 'POST',
        }).then((r) => r),
      )
      if (res.ok) {
        toast({
          title: `${plugin.name}: connection OK`,
          description: res.detail,
        })
      } else {
        toast({
          title: `${plugin.name}: test failed`,
          description: res.detail,
          variant: 'destructive',
        })
      }
      onChanged()
    } catch (e) {
      toast({
        title: 'Test failed',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setTesting(false)
    }
  }

  const connected = !!connection
  const lastOk = connection?.lastStatus === 'connected'

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.2 }}
      className={cn(
        'group relative flex flex-col gap-2 rounded-xl border bg-card p-3.5 transition-colors',
        connected
          ? 'border-primary/40 hover:border-primary/60'
          : 'border-border hover:border-primary/30',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-lg">
          {plugin.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{plugin.name}</span>
            {connected && (
              <Badge
                variant="outline"
                className={cn(
                  'gap-0.5 px-1 text-[9px]',
                  lastOk
                    ? 'border-primary/40 bg-primary/5 text-primary'
                    : connection?.lastStatus === 'failed'
                      ? 'border-destructive/40 bg-destructive/5 text-destructive'
                      : 'text-muted-foreground',
                )}
              >
                {lastOk ? (
                  <CheckCircle2 className="h-2.5 w-2.5" />
                ) : connection?.lastStatus === 'failed' ? (
                  <XCircle className="h-2.5 w-2.5" />
                ) : (
                  <Plug className="h-2.5 w-2.5" />
                )}
                {connection?.name ?? 'connected'}
              </Badge>
            )}
          </div>
          <div className="line-clamp-2 text-[11px] text-muted-foreground">
            {plugin.description}
          </div>
        </div>
      </div>

      {/* Masked config preview when connected */}
      {connected && connection.config && (
        <div className="space-y-0.5 rounded-md border border-border/60 bg-muted/30 p-1.5 font-mono text-[9px] text-muted-foreground">
          {Object.entries(connection.config)
            .slice(0, 3)
            .map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <span className="text-muted-foreground/70">{k}</span>
                <span className="truncate">{String(v)}</span>
              </div>
            ))}
        </div>
      )}

      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1 text-[9px] text-muted-foreground/70">
          {connected
            ? `checked ${formatRelative(connection!.lastCheckedAt)}`
            : 'Not connected'}
        </div>
        {connected ? (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={test}
              disabled={testing}
            >
              {testing ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="mr-1 h-3 w-3" />
              )}
              Test
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
            >
              {disconnect.isPending ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Unplug className="mr-1 h-3 w-3" />
              )}
              Disconnect
            </Button>
          </div>
        ) : (
          <Button size="sm" className="h-7 px-2.5 text-[11px]" onClick={onConnect}>
            <Plug className="mr-1 h-3 w-3" /> Connect
          </Button>
        )}
      </div>
    </motion.div>
  )
}

function ConnectDialog({
  plugin,
  onOpenChange,
  onConnected,
}: {
  plugin: PluginDTO
  onOpenChange: (o: boolean) => void
  onConnected: () => void
}) {
  const { toast } = useToast()
  const [name, setName] = React.useState(plugin.name)
  const [values, setValues] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    // Pre-fill defaults.
    const init: Record<string, string> = {}
    for (const f of plugin.configFields) {
      if (f.defaultValue !== undefined) init[f.key] = String(f.defaultValue)
    }
    setValues(init)
    setName(plugin.name)
  }, [plugin])

  const mut = useMutation({
    mutationFn: async () => {
      const config: Record<string, unknown> = {}
      for (const f of plugin.configFields) {
        const raw = (values[f.key] ?? '').trim()
        if (raw === '') continue
        config[f.key] = f.type === 'number' ? Number(raw) : raw
      }
      return j<ConnectionDTO>(
        fetch('/api/data-connections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: plugin.kind,
            name: name.trim() || plugin.name,
            config,
          }),
        }).then((r) => r),
      )
    },
    onSuccess: () => {
      toast({ title: `${plugin.name} connected` })
      onConnected()
    },
    onError: (e: Error) =>
      toast({
        title: 'Connection failed',
        description: e.message,
        variant: 'destructive',
      }),
  })

  const valid = plugin.configFields
    .filter((f) => f.required)
    .every((f) => (values[f.key] ?? '').trim().length > 0)

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="text-base">{plugin.icon}</span>
            Connect {plugin.name}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {plugin.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5 py-1">
          <div>
            <Label className="text-xs">Connection name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-sm"
            />
          </div>

          {plugin.configFields.map((f) => (
            <div key={f.key}>
              <Label className="text-xs">
                {f.label}
                {f.required && <span className="ml-0.5 text-primary">*</span>}
                {f.secret && (
                  <Badge
                    variant="outline"
                    className="ml-1.5 border-amber-500/40 bg-amber-500/5 px-1 text-[9px] text-amber-600 dark:text-amber-400"
                  >
                    secret
                  </Badge>
                )}
              </Label>
              <Input
                value={values[f.key] ?? ''}
                onChange={(e) =>
                  setValues((s) => ({ ...s, [f.key]: e.target.value }))
                }
                type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                placeholder={f.placeholder}
                className="font-mono text-xs"
                autoComplete="off"
                spellCheck={false}
              />
              {f.help && (
                <p className="mt-0.5 flex items-start gap-1 text-[10px] text-muted-foreground">
                  <ExternalLink className="mt-0.5 h-2.5 w-2.5 shrink-0" />
                  <span>{f.help}</span>
                </p>
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="text-xs">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => mut.mutate()}
            disabled={!valid || mut.isPending}
            className="text-xs"
          >
            {mut.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Plug className="mr-1 h-3 w-3" />
            )}
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
