import { describe, expect, test } from 'bun:test'
import { PRODUCTION_TOOLS, workflowStepToToolCall, isProductionExecutableStep } from './workflow-executor'
import { REDACTED_VALUE } from './workflow-trace'
import type { WorkflowStep } from '@/lib/types'

describe('production tool whitelist', () => {
  test('covers the document primitives a frozen intake run needs', () => {
    for (const t of [
      'doc_extract',
      'pdf_form_fields',
      'pdf_fill',
      'sheet_read',
      'sheet_append',
      'notify',
    ]) {
      expect(PRODUCTION_TOOLS.has(t)).toBe(true)
    }
  })

  test('still excludes discovery and design tools', () => {
    // These belong to the design conversation, not an unattended run.
    for (const t of ['web_search', 'web_read', 'workflow_freeze', 'agent_create', 'app_search']) {
      expect(PRODUCTION_TOOLS.has(t)).toBe(false)
    }
  })
})

describe('step mapping', () => {
  const step = (tool: string, inputs: Record<string, unknown>): WorkflowStep => ({
    id: 's1',
    kind: 'tool',
    label: tool,
    tool,
    inputs,
  })

  test('maps a document step to its agent tool with inputs intact', () => {
    const call = workflowStepToToolCall(
      step('pdf_fill', { path: '/f.pdf', values: { a: 'x' }, outputPath: '/out.pdf' }),
      {},
    )
    expect(call?.tool).toBe('pdf_fill')
    expect(call?.input.outputPath).toBe('/out.pdf')
  })

  test('resolves refs from earlier step outputs', () => {
    const call = workflowStepToToolCall(step('sheet_append', { path: '{{s0.dest}}', rows: [] }), {
      s0: { dest: '/tracker.xlsx' },
    })
    expect(call?.input.path).toBe('/tracker.xlsx')
  })

  test('rejects a tool that is not production-executable', () => {
    expect(workflowStepToToolCall(step('web_search', { query: 'x' }), {})).toBeNull()
  })

  test('document steps report as executable agent-free', () => {
    expect(
      isProductionExecutableStep(step('doc_extract', { path: '/a.pdf', fields: ['dob'] })),
    ).toBe(true)
    expect(isProductionExecutableStep(step('notify', { title: 't', body: 'b' }))).toBe(true)
  })
})

describe('redaction placeholders must be caught before ref resolution', () => {
  test('resolveRefs blanks the placeholder, so a post-resolution check cannot see it', () => {
    // This is the trap: after resolution a redacted value is indistinguishable
    // from an intentionally empty one, and pdf_fill would write blank fields
    // into a real form and report success. The guard therefore runs on the raw
    // step inputs — this test pins the behavior that makes that necessary.
    const call = workflowStepToToolCall(
      {
        id: 's1',
        kind: 'tool',
        label: 'fill',
        tool: 'pdf_fill',
        inputs: { path: '/f.pdf', values: { 'applicant.dob': REDACTED_VALUE } },
      },
      {},
    )
    expect((call?.input.values as Record<string, string>)['applicant.dob']).toBe('')
  })
})
