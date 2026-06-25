/** Expand markdown tables that were collapsed onto a single line by the LLM. */
export function normalizeMarkdownTables(text: string): string {
  return text
    .split('\n')
    .map((line) => expandCollapsedTableLine(line))
    .join('\n')
}

function expandCollapsedTableLine(line: string): string {
  const pipeCount = (line.match(/\|/g) || []).length
  // Needs enough pipes + a separator row to be a collapsed GFM table.
  if (pipeCount < 6 || !/\|[-:]{2,}/.test(line)) return line

  let out = line
  let prev = ''

  // Iterate — each pass peels off one row boundary until stable.
  while (out !== prev) {
    prev = out
    out = out
      // Header (or any row) glued to separator: "| Status | |------|"
      .replace(/\|\s+\|(\s*[-:][-:| ]*\|)/g, '|\n|$1')
      // Next row with empty first column: "|---| | Location |"
      .replace(/(\|[-:| \w%(),./-]+?\|)\s+\|(\s*\|)/g, '$1\n|$2')
      // Next row starting with a date: "| Moderate | | 2025-09-25 |"
      .replace(/(\|[^|\n]+?\|)\s+\|(\s*\d{4}-)/g, '$1\n|$2')
      // Next row starting with a word (non-separator): "|---| | Location |"
      .replace(/(\|[^|\n]+?\|)\s+\|(\s+[A-Za-z])/g, '$1\n|$2')
  }

  return out
}
