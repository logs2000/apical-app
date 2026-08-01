import { describe, expect, test } from 'bun:test'
import { heuristicDistillTrace, shouldDistillTrace } from './workflow-distill'
import { isProductionExecutableStep } from './workflow-executor'
import type { EngineTraceStep } from './workflow-trace'

// Regression guard for the gap that made the document tools useless in
// production: they worked in chat, then workflow_freeze ran the trace through
// the distiller, which recognized only the seven original tools and dropped
// everything else. The frozen workflow became "list a folder, move a file" —
// no reading, no filling, no recording, no notifying.

const WATCH = '/Users/tester/Intake'

function step(tool: string, input: Record<string, unknown>, i = 0): EngineTraceStep {
  return { stepId: `t${i}`, kind: 'tool', label: tool, tool, input, status: 'done' }
}

const intakeTrace: EngineTraceStep[] = [
  step('fs_list', { path: WATCH }, 1),
  step(
    'doc_extract',
    { path: `${WATCH}/scan-0001.pdf`, fields: ['full_name', 'date_of_birth', 'member_id'] },
    2,
  ),
  step('fs_move', { from: `${WATCH}/scan-0001.pdf`, to: `${WATCH}/Cook/rivera.pdf` }, 3),
  step(
    'pdf_fill',
    {
      path: '/Users/tester/Forms/application.pdf',
      values: { 'applicant.name': 'Jordan Rivera', 'applicant.dob': '1984-03-11' },
      outputPath: `${WATCH}/Cook/rivera-application.pdf`,
    },
    4,
  ),
  step('sheet_append', { path: '/Users/tester/tracker.xlsx', rows: [{ client: 'Rivera' }] }, 5),
  step('notify', { title: 'Batch done', body: 'Filed 1.', channel: 'both' }, 6),
]

describe('document tools survive freeze', () => {
  test('a six-step intake trace routes through the distiller', () => {
    expect(shouldDistillTrace(intakeTrace)).toBe(true)
  })

  test('every document tool is kept as a tool node', () => {
    const steps = heuristicDistillTrace(intakeTrace, 'intake')
    const tools = steps.map((s) => s.tool)
    for (const expected of [
      'fs_list',
      'doc_extract',
      'fs_move',
      'pdf_fill',
      'sheet_append',
      'notify',
    ]) {
      expect(tools).toContain(expected)
    }
  })

  test('every distilled step can run without an agent', () => {
    for (const s of heuristicDistillTrace(intakeTrace, 'intake')) {
      expect(isProductionExecutableStep(s)).toBe(true)
    }
  })

  test('inputs survive, not just the tool names', () => {
    // A step that keeps its name but loses its payload fails at run time
    // instead of freeze time, which is strictly worse.
    const steps = heuristicDistillTrace(intakeTrace, 'intake')
    const fill = steps.find((s) => s.tool === 'pdf_fill')
    expect(Object.keys((fill?.inputs?.values ?? {}) as object)).toHaveLength(2)
    expect(fill?.inputs?.outputPath).toBe(`${WATCH}/Cook/rivera-application.pdf`)

    const extract = steps.find((s) => s.tool === 'doc_extract')
    expect(extract?.inputs?.fields).toHaveLength(3)

    const append = steps.find((s) => s.tool === 'sheet_append')
    expect(Array.isArray(append?.inputs?.rows)).toBe(true)

    const notify = steps.find((s) => s.tool === 'notify')
    expect(notify?.inputs?.title).toBe('Batch done')
  })

  test('marks document steps hardened so production runs them deterministically', () => {
    const steps = heuristicDistillTrace(intakeTrace, 'intake')
    for (const s of steps.filter((x) => x.tool !== 'fs_list')) {
      expect(s.hardened).toBe(true)
    }
  })
})

describe('batch dedupe', () => {
  test('reading twenty files with the same field set becomes one node', () => {
    const batch: EngineTraceStep[] = [
      intakeTrace[0],
      ...Array.from({ length: 20 }, (_, i) =>
        step('doc_extract', { path: `${WATCH}/scan-${i}.pdf`, fields: ['full_name'] }, 100 + i),
      ),
      intakeTrace[5],
    ]
    const steps = heuristicDistillTrace(batch, 'batch')
    expect(steps.filter((s) => s.tool === 'doc_extract')).toHaveLength(1)
  })

  test('different field sets stay separate steps', () => {
    // Reading IDs and reading pay stubs are genuinely different operations.
    const mixed: EngineTraceStep[] = [
      intakeTrace[0],
      step('doc_extract', { path: `${WATCH}/id.pdf`, fields: ['full_name', 'dob'] }, 1),
      step('doc_extract', { path: `${WATCH}/stub.pdf`, fields: ['employer', 'gross_pay'] }, 2),
      intakeTrace[5],
    ]
    expect(
      heuristicDistillTrace(mixed, 'mixed').filter((s) => s.tool === 'doc_extract'),
    ).toHaveLength(2)
  })

  test('appends to two different sheets stay separate', () => {
    const twoSheets: EngineTraceStep[] = [
      intakeTrace[0],
      step('sheet_append', { path: '/a/filed.xlsx', rows: [{ x: 1 }] }, 1),
      step('sheet_append', { path: '/a/flagged.xlsx', rows: [{ x: 2 }] }, 2),
      intakeTrace[5],
    ]
    expect(
      heuristicDistillTrace(twoSheets, 'two').filter((s) => s.tool === 'sheet_append'),
    ).toHaveLength(2)
  })
})

describe('exploration is still dropped', () => {
  test('web_search and repeated listings do not become workflow steps', () => {
    const noisy: EngineTraceStep[] = [
      step('web_search', { query: 'medicaid form' }, 1),
      step('fs_list', { path: WATCH }, 2),
      step('fs_list', { path: `${WATCH}/Cook` }, 3),
      step('credential_list', {}, 4),
      ...intakeTrace.slice(1),
    ]
    const steps = heuristicDistillTrace(noisy, 'noisy')
    expect(steps.some((s) => s.tool === 'web_search')).toBe(false)
    expect(steps.some((s) => s.tool === 'credential_list')).toBe(false)
    expect(steps.filter((s) => s.tool === 'fs_list')).toHaveLength(1)
  })
})
