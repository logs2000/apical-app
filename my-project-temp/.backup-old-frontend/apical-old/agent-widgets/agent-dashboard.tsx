'use client'

import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { relativeTime } from '@/lib/apical'
import {
  TrendingUp, TrendingDown, AlertTriangle, Info,
  BarChart3, List, Table, Gauge,
} from 'lucide-react'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, ResponsiveContainer, Tooltip,
} from 'recharts'

interface Widget {
  id: string
  type: 'stat' | 'table' | 'list' | 'chart' | 'alert' | 'progress'
  title: string
  data: Record<string, unknown>
  column?: number
  order?: number
  updatedAt: string
}

const CHART_COLORS = ['oklch(0.65 0.12 155)', 'oklch(0.70 0.08 260)', 'oklch(0.68 0.10 75)', 'oklch(0.62 0.12 230)', 'oklch(0.72 0.10 300)']

export function AgentDashboard({ agentId }: { agentId: string }) {
  const { data: widgets } = useQuery<Widget[]>({
    queryKey: ['agent-widgets', agentId],
    queryFn: async () => {
      const r = await fetch(`/api/agents/${agentId}/widgets`)
      if (!r.ok) return []
      return r.json()
    },
  })

  if (!widgets || widgets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        No dashboard yet. This agent will build its own dashboard widgets as it runs.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
        <Gauge className="h-2.5 w-2.5" /> Agent dashboard · auto-built · updated {relativeTime(widgets[0]?.updatedAt ?? new Date().toISOString())}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {widgets.map((w) => <WidgetCard key={w.id} widget={w} />)}
      </div>
    </div>
  )
}

function WidgetCard({ widget }: { widget: Widget }) {
  const data = widget.data
  return (
    <Card className="overflow-hidden p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <WidgetIcon type={widget.type} />
        <span className="text-xs font-medium">{widget.title}</span>
      </div>
      {widget.type === 'stat' && <StatWidget data={data} />}
      {widget.type === 'table' && <TableWidget data={data} />}
      {widget.type === 'list' && <ListWidget data={data} />}
      {widget.type === 'chart' && <ChartWidget data={data} />}
      {widget.type === 'alert' && <AlertWidget data={data} />}
      {widget.type === 'progress' && <ProgressWidget data={data} />}
    </Card>
  )
}

function WidgetIcon({ type }: { type: string }) {
  const icons: Record<string, React.ComponentType<{ className?: string }>> = {
    stat: Gauge, table: Table, list: List, chart: BarChart3, alert: AlertTriangle, progress: Gauge,
  }
  const Icon = icons[type] ?? Gauge
  return <Icon className="h-3 w-3 text-muted-foreground" />
}

function StatWidget({ data }: { data: Record<string, unknown> }) {
  const value = String(data.value ?? '—')
  const label = String(data.label ?? '')
  const trend = data.trend as string | undefined
  const unit = data.unit as string | undefined
  const isUp = trend?.startsWith('+')
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums">
        {value}{unit ? <span className="ml-1 text-sm text-muted-foreground">{unit}</span> : null}
      </div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      {trend && (
        <div className={cn('mt-0.5 flex items-center gap-0.5 text-[10px]', isUp ? 'text-emerald-500' : 'text-destructive')}>
          {isUp ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
          {trend}
        </div>
      )}
    </div>
  )
}

function TableWidget({ data }: { data: Record<string, unknown> }) {
  const columns = (data.columns as string[]) ?? []
  const rows = (data.rows as unknown[][]) ?? []
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border">
            {columns.map((c, i) => <th key={i} className="py-1 pr-2 text-left font-medium text-muted-foreground">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 5).map((row, i) => (
            <tr key={i} className="border-b border-border/40">
              {row.map((cell, j) => <td key={j} className="py-1 pr-2">{String(cell)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ListWidget({ data }: { data: Record<string, unknown> }) {
  const items = (data.items as Array<{ title: string; subtitle?: string; badge?: string }>) ?? []
  return (
    <div className="space-y-1">
      {items.slice(0, 5).map((item, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium">{item.title}</div>
            {item.subtitle && <div className="truncate text-[10px] text-muted-foreground">{item.subtitle}</div>}
          </div>
          {item.badge && (
            <Badge variant="outline" className={cn(
              'shrink-0 text-[9px]',
              item.badge === 'flagged' && 'border-gate/40 text-gate-foreground',
              item.badge === 'auto' && 'border-emerald-500/40 text-emerald-500',
            )}>{item.badge}</Badge>
          )}
        </div>
      ))}
    </div>
  )
}

function ChartWidget({ data }: { data: Record<string, unknown> }) {
  const type = data.type as string
  const labels = (data.labels as string[]) ?? []
  const values = (data.values as number[]) ?? []
  const chartData = labels.map((l, i) => ({ name: l, value: values[i] ?? 0 }))

  if (type === 'pie') {
    return (
      <ResponsiveContainer width="100%" height={120}>
        <PieChart>
          <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={45} innerRadius={25}>
            {chartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={{ fontSize: '10px', background: 'var(--card)', border: '1px solid var(--border)' }} />
        </PieChart>
      </ResponsiveContainer>
    )
  }
  if (type === 'line') {
    return (
      <ResponsiveContainer width="100%" height={100}>
        <LineChart data={chartData}>
          <XAxis dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
          <YAxis hide />
          <Tooltip contentStyle={{ fontSize: '10px', background: 'var(--card)', border: '1px solid var(--border)' }} />
          <Line type="monotone" dataKey="value" stroke="oklch(0.65 0.12 155)" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={100}>
      <BarChart data={chartData}>
        <XAxis dataKey="name" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
        <YAxis hide />
        <Tooltip contentStyle={{ fontSize: '10px', background: 'var(--card)', border: '1px solid var(--border)' }} />
        <Bar dataKey="value" fill="oklch(0.65 0.12 155)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function AlertWidget({ data }: { data: Record<string, unknown> }) {
  const level = data.level as string
  const message = String(data.message ?? '')
  const Icon = level === 'critical' ? AlertTriangle : level === 'warning' ? AlertTriangle : Info
  const cls = level === 'critical' ? 'text-destructive border-destructive/30 bg-destructive/5'
    : level === 'warning' ? 'text-gate-foreground border-gate/30 bg-gate/5'
    : 'text-primary border-primary/30 bg-primary/5'
  return (
    <div className={cn('flex items-start gap-1.5 rounded-lg border p-2', cls)}>
      <Icon className="mt-0.5 h-3 w-3 shrink-0" />
      <span className="text-[11px]">{message}</span>
    </div>
  )
}

function ProgressWidget({ data }: { data: Record<string, unknown> }) {
  const label = String(data.label ?? '')
  const current = Number(data.current ?? 0)
  const total = Number(data.total ?? 1)
  const unit = data.unit as string | undefined
  const pct = total > 0 ? Math.round((current / total) * 100) : 0
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{current}/{total}{unit ? ` ${unit}` : ''}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-0.5 text-right text-[10px] text-muted-foreground">{pct}%</div>
    </div>
  )
}
