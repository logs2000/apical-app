// Golden-path check: does a realistic intake trace survive workflow_freeze?
//
// The agent doing the work in chat is only half the product. The other half is
// `workflow_freeze` turning that trace into a workflow that runs later with no
// agent in the loop. Between the two sits the distiller, which rewrites and
// drops steps — and which, before this was fixed, silently discarded every
// document tool, leaving a frozen workflow that listed a folder and moved a
// file while the reading, filling, recording, and notifying vanished.
//
// This script replays that exact shape and asserts nothing is lost. It is not
// part of `bun test` (it exercises the heuristic path end-to-end and reads
// like a smoke test); run it directly:
//
//   bunx tsx scripts/verify-golden-path.mts
//
// The equivalent assertion lives in workflow-distill.test.ts for CI.

import {
  heuristicDistillTrace,
  shouldDistillTrace,
} from '../src/lib/platform/workflow-distill'
import { isProductionExecutableStep } from '../src/lib/platform/workflow-executor'
import type { EngineTraceStep } from '../src/lib/platform/workflow-trace'

const WATCH = '/Users/tester/Intake'

/** What a real Medicaid-style intake turn actually looks like in the trace. */
const trace: EngineTraceStep[] = [
  {
    stepId: 't1',
    kind: 'tool',
    label: 'List intake folder',
    tool: 'fs_list',
    input: { path: WATCH },
    status: 'done',
  },
  {
    stepId: 't2',
    kind: 'tool',
    label: 'Read scanned ID',
    tool: 'doc_extract',
    input: {
      path: `${WATCH}/scan-0001.pdf`,
      fields: ['full_name', 'date_of_birth', 'member_id', 'county'],
      instructions: 'State ID or Medicaid card. Transcribe values exactly as printed.',
    },
    status: 'done',
  },
  {
    stepId: 't3',
    kind: 'tool',
    label: 'File the scan',
    tool: 'fs_move',
    input: { from: `${WATCH}/scan-0001.pdf`, to: `${WATCH}/Cook/rivera-jordan-1984-03-11.pdf` },
    status: 'done',
  },
  {
    stepId: 't4',
    kind: 'tool',
    label: 'Fill the application',
    tool: 'pdf_fill',
    input: {
      path: '/Users/tester/Forms/application.pdf',
      values: { 'applicant.name': 'Jordan Rivera', 'applicant.dob': '1984-03-11' },
      outputPath: `${WATCH}/Cook/rivera-jordan-application.pdf`,
      flatten: true,
    },
    status: 'done',
  },
  {
    stepId: 't5',
    kind: 'tool',
    label: 'Record it',
    tool: 'sheet_append',
    input: {
      path: '/Users/tester/tracker.xlsx',
      rows: [{ client: 'Jordan Rivera', county: 'Cook', status: 'filed' }],
    },
    status: 'done',
  },
  {
    stepId: 't6',
    kind: 'tool',
    label: 'Tell the user',
    tool: 'notify',
    input: { title: 'Intake batch done', body: 'Filed 1 application, 0 flagged.', channel: 'both' },
    status: 'done',
  },
]

const EXPECTED = ['fs_list', 'doc_extract', 'fs_move', 'pdf_fill', 'sheet_append', 'notify']

let failures = 0
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`)
  if (!ok) failures++
}

// A six-step trace is over the distill threshold, so this is the path a real
// intake turn takes — not the raw-steps shortcut.
check(shouldDistillTrace(trace), 'six-step intake trace routes through the distiller')

const steps = heuristicDistillTrace(trace, 'Medicaid intake')
console.log(`\nDistilled ${steps.length} steps:`)
for (const s of steps) console.log(`  - ${s.tool ?? s.kind}: ${s.label}`)
console.log()

for (const tool of EXPECTED) {
  check(
    steps.some((s) => s.tool === tool),
    `${tool} survives freeze`,
  )
}

for (const s of steps) {
  check(isProductionExecutableStep(s), `${s.tool ?? s.kind} is executable agent-free`)
}

// The inputs have to survive too — a step that keeps its name but loses its
// payload fails at run time instead of at freeze time, which is worse.
const fill = steps.find((s) => s.tool === 'pdf_fill')
check(
  !!fill?.inputs?.values && Object.keys(fill.inputs.values as object).length === 2,
  'pdf_fill keeps its field values',
)
const append = steps.find((s) => s.tool === 'sheet_append')
check(Array.isArray(append?.inputs?.rows), 'sheet_append keeps its rows')
const extract = steps.find((s) => s.tool === 'doc_extract')
check(
  Array.isArray(extract?.inputs?.fields) && (extract.inputs.fields as string[]).length === 4,
  'doc_extract keeps its requested fields',
)

// A batch loop must not become twenty identical nodes.
const batch: EngineTraceStep[] = [
  trace[0],
  ...Array.from({ length: 5 }, (_, i) => ({
    ...trace[1],
    stepId: `b${i}`,
    input: { ...trace[1].input, path: `${WATCH}/scan-000${i}.pdf` },
  })),
  trace[5],
]
const batchSteps = heuristicDistillTrace(batch, 'Medicaid intake batch')
check(
  batchSteps.filter((s) => s.tool === 'doc_extract').length === 1,
  'five reads of the same field set collapse to one node',
)

console.log(`\n${failures === 0 ? 'Golden path holds.' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
