import { describe, expect, test } from 'bun:test'
import {
  REDACTED_VALUE,
  humanWorkflowLabel,
  sanitizeTraceInput,
  traceStepHasExecutableParams,
  type EngineTraceStep,
} from './workflow-trace'

describe('sanitizeTraceInput', () => {
  test('drops auth-shaped keys', () => {
    const out = sanitizeTraceInput({
      url: 'https://x/y',
      authorization: 'Bearer abc',
      api_key: 'k',
      token: 't',
      password: 'p',
    })
    expect(out).toEqual({ url: 'https://x/y' })
  })

  test('redacts the values a PDF fill would write, keeping the field names', () => {
    // These come straight off someone's ID. The frozen workflow needs to know
    // WHICH fields it fills, not what one applicant's answers were.
    const out = sanitizeTraceInput({
      path: '/Forms/application.pdf',
      values: { 'applicant.name': 'Jordan Rivera', 'applicant.dob': '1984-03-11' },
    })
    expect(out.path).toBe('/Forms/application.pdf')
    expect(out.values).toEqual({
      'applicant.name': REDACTED_VALUE,
      'applicant.dob': REDACTED_VALUE,
    })
  })

  test('redacts spreadsheet row values but keeps the columns', () => {
    const out = sanitizeTraceInput({
      path: '/tracker.xlsx',
      rows: [{ client: 'Jordan Rivera', member_id: 'A12345', status: 'filed' }],
    })
    expect(out.rows).toEqual([
      { client: REDACTED_VALUE, member_id: REDACTED_VALUE, status: REDACTED_VALUE },
    ])
  })

  test('keeps null so "field was not present" survives', () => {
    // Downstream steps branch on missing fields; null is signal, not PII.
    const out = sanitizeTraceInput({ values: { dob: null, name: 'X' } })
    expect(out.values).toEqual({ dob: null, name: REDACTED_VALUE })
  })

  test('leaves non-document inputs alone', () => {
    const out = sanitizeTraceInput({ path: '/a/b.pdf', fields: ['dob'], sheetName: 'Intake' })
    expect(out).toEqual({ path: '/a/b.pdf', fields: ['dob'], sheetName: 'Intake' })
  })

  test('truncates very long strings', () => {
    const out = sanitizeTraceInput({ code: 'x'.repeat(5000) })
    expect((out.code as string).length).toBeLessThanOrEqual(4001)
  })

  test('redacted values still leave the step executable', () => {
    // The guard would be self-defeating if redaction made the frozen step
    // fail validation.
    const step: EngineTraceStep = {
      stepId: 't1',
      kind: 'tool',
      label: 'fill',
      tool: 'pdf_fill',
      input: sanitizeTraceInput({
        path: '/Forms/a.pdf',
        values: { 'applicant.name': 'Jordan Rivera' },
      }),
      status: 'done',
    }
    expect(traceStepHasExecutableParams(step)).toBe(true)
  })
})

describe('humanWorkflowLabel for document steps', () => {
  test.each([
    ['doc_extract', { path: '/W/scan.pdf', fields: ['a', 'b'] }, 'Read 2 fields'],
    ['pdf_form_fields', { path: '/W/form.pdf' }, 'Inspect form fields'],
    ['pdf_fill', { path: '/W/form.pdf', values: { a: 1 } }, 'Fill'],
    ['sheet_read', { path: '/W/t.xlsx' }, 'Read rows from'],
    ['sheet_append', { path: '/W/t.xlsx', rows: [{ a: 1 }] }, 'Append'],
    ['notify', { title: 'Batch done' }, 'Notify: Batch done'],
  ])('%s reads as plain English', (tool, input, expected) => {
    expect(humanWorkflowLabel(tool, input as Record<string, unknown>)).toContain(expected)
  })

  test('falls back gracefully when the source is an upload rather than a path', () => {
    expect(humanWorkflowLabel('doc_extract', { assetId: 'asset_1' })).toContain('uploaded file')
  })
})
