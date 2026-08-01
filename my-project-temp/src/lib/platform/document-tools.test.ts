import { describe, expect, test } from 'bun:test'
import { PDFDocument } from 'pdf-lib'
import {
  appendCsv,
  appendXlsx,
  basename,
  fillPdfForm,
  isCsvName,
  loadDoc,
  parseCsv,
  readPdfFormFields,
  readSheet,
  type DocFileIO,
} from './document-tools'

/** A PDF with a real AcroForm — the fill path is worth nothing against a mock. */
async function makeForm(): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([600, 400])
  const form = pdf.getForm()

  form.createTextField('applicant.name').addToPage(page, { x: 50, y: 320, width: 300, height: 24 })
  form.createTextField('applicant.dob').addToPage(page, { x: 50, y: 280, width: 300, height: 24 })
  form.createCheckBox('consent').addToPage(page, { x: 50, y: 240, width: 18, height: 18 })

  const county = form.createDropdown('county')
  county.setOptions(['Cook', 'DuPage', 'Lake'])
  county.addToPage(page, { x: 50, y: 200, width: 200, height: 24 })

  return Buffer.from(await pdf.save())
}

describe('pdf forms', () => {
  test('lists every fillable field with its type and options', async () => {
    const fields = await readPdfFormFields(await makeForm())
    expect(fields.map((f) => f.name).sort()).toEqual([
      'applicant.dob',
      'applicant.name',
      'consent',
      'county',
    ])
    expect(fields.find((f) => f.name === 'consent')?.type).toBe('checkbox')
    expect(fields.find((f) => f.name === 'county')?.options).toEqual(['Cook', 'DuPage', 'Lake'])
  })

  test('fills fields and the values survive a save/reload round trip', async () => {
    const out = await fillPdfForm(await makeForm(), {
      'applicant.name': 'Jordan Rivera',
      'applicant.dob': '1984-03-11',
      consent: 'yes',
      county: 'cook', // dropdown match is case-insensitive
    })
    expect(out.skipped).toEqual([])

    const reread = await readPdfFormFields(out.bytes)
    const byName = Object.fromEntries(reread.map((f) => [f.name, f.value]))
    expect(byName['applicant.name']).toBe('Jordan Rivera')
    expect(byName['consent']).toBe(true)
    expect(byName['county']).toEqual(['Cook'])
  })

  test.each([
    ['yes', true],
    ['true', true],
    ['1', true],
    ['x', true],
    ['checked', true],
    ['no', false],
    ['false', false],
    ['', false],
  ])('checkbox accepts %p as %p', async (input, expected) => {
    const out = await fillPdfForm(await makeForm(), { consent: input })
    const fields = await readPdfFormFields(out.bytes)
    expect(fields.find((f) => f.name === 'consent')?.value).toBe(expected)
  })

  test('reports unknown field names instead of dropping them silently', async () => {
    const out = await fillPdfForm(await makeForm(), { 'not.a.field': 'x' })
    expect(out.filled).toEqual([])
    expect(out.skipped).toHaveLength(1)
    expect(out.skipped[0].name).toBe('not.a.field')
    expect(out.skipped[0].reason).toContain('pdf_form_fields')
  })

  test('reports a dropdown value that is not an allowed option', async () => {
    const out = await fillPdfForm(await makeForm(), { county: 'Nowhere' })
    expect(out.filled).toEqual([])
    expect(out.skipped[0].reason).toContain('Cook')
  })

  test('a partial fill still reports the fields it did manage', async () => {
    const out = await fillPdfForm(await makeForm(), {
      'applicant.name': 'Jordan Rivera',
      bogus: 'x',
    })
    expect(out.filled).toEqual(['applicant.name'])
    expect(out.skipped).toHaveLength(1)
  })

  test('flattening produces a still-loadable PDF', async () => {
    const out = await fillPdfForm(await makeForm(), { 'applicant.name': 'Flat' }, { flatten: true })
    const doc = await PDFDocument.load(out.bytes)
    expect(doc.getPageCount()).toBe(1)
    // Flattened forms have no interactive fields left.
    expect(await readPdfFormFields(out.bytes)).toEqual([])
  })
})

describe('xlsx append', () => {
  test('creates the workbook, sheet, and header on first run', async () => {
    const out = await appendXlsx(null, [{ client: 'Rivera', status: 'filed' }])
    expect(out.createdFile).toBe(true)
    expect(out.headers).toEqual(['client', 'status'])
    expect(out.totalRows).toBe(1)
  })

  test('widens the header for a new column rather than dropping it', async () => {
    const first = await appendXlsx(null, [{ client: 'Rivera', status: 'filed' }])
    const second = await appendXlsx(first.bytes, [
      { client: 'Okonkwo', status: 'flagged', note: 'DOB unreadable' },
    ])
    expect(second.headers).toEqual(['client', 'status', 'note'])
    expect(second.totalRows).toBe(2)

    // The pre-existing row must stay aligned under the widened header.
    const read = await readSheet(second.bytes, 'tracker.xlsx')
    expect(read.rows[0]).toEqual({ client: 'Rivera', status: 'filed', note: '' })
    expect(read.rows[1].note).toBe('DOB unreadable')
  })

  test('appends to a named sheet, creating it when absent', async () => {
    const first = await appendXlsx(null, [{ a: '1' }], { sheetName: 'Intake' })
    expect(first.createdSheet).toBe(true)
    const read = await readSheet(first.bytes, 'x.xlsx', { sheetName: 'Intake' })
    expect(read.rows).toEqual([{ a: '1' }])
  })

  test('rejects rows that are not objects', async () => {
    await expect(appendXlsx(null, ['not an object'])).rejects.toThrow('must be an object')
    await expect(appendXlsx(null, 'nope')).rejects.toThrow('must be an array')
  })

  test('reports a missing named sheet with the names that do exist', async () => {
    const wb = await appendXlsx(null, [{ a: '1' }], { sheetName: 'Intake' })
    await expect(readSheet(wb.bytes, 'x.xlsx', { sheetName: 'Missing' })).rejects.toThrow('Intake')
  })
})

describe('csv', () => {
  test('escapes commas and quotes, and round-trips through the parser', () => {
    const one = appendCsv(null, [{ a: '1', b: 'two, with comma' }])
    const two = appendCsv(one.bytes, [{ a: '3', b: 'q"uote', c: 'new col' }])
    const text = two.bytes.toString('utf8')

    expect(text).toContain('"two, with comma"')
    expect(text).toContain('"q""uote"')
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['1', 'two, with comma', ''],
      ['3', 'q"uote', 'new col'],
    ])
  })

  test('parses embedded newlines inside quoted cells', () => {
    expect(parseCsv('a,b\n"line1\nline2",x\n')).toEqual([
      ['a', 'b'],
      ['line1\nline2', 'x'],
    ])
  })

  test('reads back as objects keyed by the header', async () => {
    const csv = appendCsv(null, [{ name: 'Rivera', county: 'Cook' }])
    const read = await readSheet(csv.bytes, 'tracker.csv')
    expect(read.rows).toEqual([{ name: 'Rivera', county: 'Cook' }])
  })

  test('isCsvName distinguishes csv from xlsx', () => {
    expect(isCsvName('a.csv')).toBe(true)
    expect(isCsvName('A.CSV')).toBe(true)
    expect(isCsvName('a.xlsx')).toBe(false)
  })
})

describe('source resolution', () => {
  const io: DocFileIO = {
    readDesktopFile: async () => Buffer.from('desktop'),
    writeDesktopFile: async () => {},
    readAsset: async () => ({ bytes: Buffer.from('asset'), name: 'a.pdf' }),
    writeAsset: async () => ({ id: 'asset_1', url: '/x' }),
    fetchUrl: async () => ({ bytes: Buffer.from('url'), name: 'u.pdf' }),
  }

  test('requires exactly one of path, assetId, or url', async () => {
    await expect(loadDoc({}, io)).rejects.toThrow('Give one of')
    await expect(loadDoc({ path: '/a', url: 'https://x/y' }, io)).rejects.toThrow('exactly one')
  })

  test('resolves each source kind', async () => {
    expect((await loadDoc({ path: '/tmp/a.pdf' }, io)).name).toBe('a.pdf')
    expect((await loadDoc({ assetId: 'asset_1' }, io)).name).toBe('a.pdf')
    expect((await loadDoc({ url: 'https://x/u.pdf' }, io)).bytes.toString()).toBe('url')
  })

  test('surfaces a missing asset rather than returning empty bytes', async () => {
    await expect(loadDoc({ assetId: 'gone' }, { ...io, readAsset: async () => null })).rejects.toThrow(
      'not found',
    )
  })

  test('basename handles both separators', () => {
    expect(basename('/a/b/c.pdf')).toBe('c.pdf')
    expect(basename('C:\\Users\\t\\c.pdf')).toBe('c.pdf')
  })
})
