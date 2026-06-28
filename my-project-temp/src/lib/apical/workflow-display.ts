import type { WorkflowStep } from '@/lib/types'

/** Secondary line for workflow UI — paths, commands, script preview. */
export function workflowStepDetail(step: WorkflowStep): string | null {
  if (step.code?.source) {
    const line = step.code.source.split('\n').find((l) => l.trim()) ?? step.code.source
    return `${step.code.language}: ${line.length > 100 ? line.slice(0, 100) + '…' : line}`
  }
  if (step.mcp?.tool) {
    return `MCP ${step.mcp.tool}${step.mcp.integrationId ? ` (${step.mcp.integrationId.slice(0, 8)}…)` : ''}`
  }
  if (step.http?.url) return step.http.url
  const inputs = step.inputs ?? {}
  if (typeof inputs.path === 'string' && inputs.path) return inputs.path
  if (typeof inputs.from === 'string' && typeof inputs.to === 'string') {
    return `${inputs.from} → ${inputs.to}`
  }
  if (typeof inputs.command === 'string') {
    const args = Array.isArray(inputs.args) ? inputs.args.map(String).join(' ') : ''
    return `${inputs.command}${args ? ` ${args}` : ''}`.trim()
  }
  if (typeof inputs.code === 'string' && inputs.code) {
    const line = inputs.code.split('\n').find((l) => l.trim()) ?? inputs.code
    return line.length > 100 ? `${line.slice(0, 100)}…` : line
  }
  if (typeof inputs.query === 'string') return inputs.query
  if (typeof inputs.url === 'string') return inputs.url
  return null
}

/** Friendly tool badge (not raw snake_case). */
export function workflowStepToolLabel(step: WorkflowStep): string {
  if (step.hardened) return 'Automated'
  if (step.code) return 'Code'
  if (step.mcp) return 'MCP'
  if (step.http) return 'API'
  if (step.integrationId) return 'Integration'
  switch (step.tool) {
    case 'fs_list':
      return 'List folder'
    case 'fs_read':
      return 'Read file'
    case 'fs_write':
      return 'Write file'
    case 'fs_move':
      return 'Move file'
    case 'cli_run':
      return 'Shell'
    case 'script_run':
      return 'Script'
    case 'http':
      return 'API call'
    default:
      return step.tool?.replace(/_/g, ' ') ?? 'Step'
  }
}
