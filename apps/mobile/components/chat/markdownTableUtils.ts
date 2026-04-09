const TABLE_LABEL_MIN_WIDTH = 72
const TABLE_LABEL_MAX_WIDTH = 104
const TABLE_DATA_MIN_WIDTH = 92
const TABLE_DATA_MAX_WIDTH = 152
const TABLE_CELL_HORIZONTAL_PADDING = 20
const APPROX_CHAR_WIDTH = 7

export type MarkdownBlock =
  | {
      type: 'markdown'
      content: string
    }
  | {
      type: 'table'
      headers: string[]
      rows: string[][]
    }

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function getFenceMarker(line: string): '```' | '~~~' | null {
  const trimmed = line.trimStart()
  if (trimmed.startsWith('```')) return '```'
  if (trimmed.startsWith('~~~')) return '~~~'
  return null
}

export function isMarkdownTableSeparator(line: string) {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+(?:\s*:?-{3,}:?\s*)\|?\s*$/.test(line)
}

function isMarkdownTableRow(line: string) {
  return line.trim().length > 0 && line.includes('|')
}

export function parseMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim()
  const withoutOuterPipes = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  return withoutOuterPipes.split('|').map((cell) => cell.trim())
}

export function splitMarkdownBlocks(source: string): MarkdownBlock[] {
  const lines = source.split('\n')
  const blocks: MarkdownBlock[] = []
  const markdownBuffer: string[] = []
  let activeFenceMarker: '```' | '~~~' | null = null

  const flushMarkdownBuffer = () => {
    const content = markdownBuffer.join('\n')
    if (content.trim()) {
      blocks.push({ type: 'markdown', content })
    }
    markdownBuffer.length = 0
  }

  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const separator = lines[index + 1] ?? ''
    const fenceMarker = getFenceMarker(line)

    if (activeFenceMarker) {
      markdownBuffer.push(line)
      if (fenceMarker === activeFenceMarker) {
        activeFenceMarker = null
      }
      index += 1
      continue
    }

    if (fenceMarker) {
      markdownBuffer.push(line)
      activeFenceMarker = fenceMarker
      index += 1
      continue
    }

    if (isMarkdownTableRow(line) && isMarkdownTableSeparator(separator)) {
      const candidateLines = [line, separator]
      let bodyIndex = index + 2
      while (bodyIndex < lines.length && isMarkdownTableRow(lines[bodyIndex] ?? '')) {
        candidateLines.push(lines[bodyIndex] ?? '')
        bodyIndex += 1
      }

      const parsedRows = candidateLines
        .filter((_, rowIndex) => rowIndex !== 1)
        .map(parseMarkdownTableRow)
      const columnCount = parsedRows[0]?.length ?? 0
      const isValidTable = columnCount >= 2 && parsedRows.every((row) => row.length === columnCount)

      if (isValidTable) {
        flushMarkdownBuffer()
        blocks.push({
          type: 'table',
          headers: parsedRows[0] ?? [],
          rows: parsedRows.slice(1),
        })
        index = bodyIndex
        continue
      }
    }

    markdownBuffer.push(line)
    index += 1
  }

  flushMarkdownBuffer()
  return blocks.length > 0 ? blocks : [{ type: 'markdown', content: source }]
}

function estimateColumnWidth(values: string[], isLabelColumn: boolean): number {
  const longestLineLength = values.reduce((maxLength, value) => {
    const lineMax = value
      .split('\n')
      .reduce((longest, line) => Math.max(longest, line.trim().length), 0)
    return Math.max(maxLength, lineMax)
  }, 0)

  const estimatedWidth = longestLineLength * APPROX_CHAR_WIDTH + TABLE_CELL_HORIZONTAL_PADDING
  return clamp(
    estimatedWidth,
    isLabelColumn ? TABLE_LABEL_MIN_WIDTH : TABLE_DATA_MIN_WIDTH,
    isLabelColumn ? TABLE_LABEL_MAX_WIDTH : TABLE_DATA_MAX_WIDTH
  )
}

export function buildColumnWidths(headers: string[], rows: string[][]): number[] {
  const columnCount = headers.length
  if (columnCount === 0) return []

  const allRows = [headers, ...rows]
  return Array.from({ length: columnCount }, (_, columnIndex) =>
    estimateColumnWidth(
      allRows.map((row) => row[columnIndex] ?? ''),
      columnIndex === 0
    )
  )
}

export function buildColumnGrowthWeights(columnWidths: number[]): number[] {
  return columnWidths.map((width, index) =>
    index === 0 ? Math.max(width * 0.45, 1) : Math.max(width * 1.15, 1)
  )
}
