import { describe, expect, it } from 'vitest'
import {
  buildColumnGrowthWeights,
  buildColumnWidths,
  isMarkdownTableSeparator,
  parseMarkdownTableRow,
  splitMarkdownBlocks,
} from './markdownTableUtils'

describe('markdownTableUtils', () => {
  describe('isMarkdownTableSeparator', () => {
    it('detects valid separators', () => {
      expect(isMarkdownTableSeparator('| --- | --- | --- |')).toBe(true)
      expect(isMarkdownTableSeparator('--- | --- | ---')).toBe(true)
      expect(isMarkdownTableSeparator('| :--- | ---: | :---: |')).toBe(true)
    })

    it('rejects non-separators', () => {
      expect(isMarkdownTableSeparator('| data | data |')).toBe(false)
      expect(isMarkdownTableSeparator('| - | - |')).toBe(false)
    })
  })

  describe('parseMarkdownTableRow', () => {
    it('parses rows with or without outer pipes', () => {
      expect(parseMarkdownTableRow('| Label | Value1 | Value2 |')).toEqual([
        'Label',
        'Value1',
        'Value2',
      ])
      expect(parseMarkdownTableRow('A | B | C')).toEqual(['A', 'B', 'C'])
    })

    it('trims cell whitespace', () => {
      expect(parseMarkdownTableRow('|  Spaced  |  Values  |')).toEqual(['Spaced', 'Values'])
    })
  })

  describe('splitMarkdownBlocks', () => {
    it('extracts table blocks from mixed markdown', () => {
      const markdown = `Before\n\n| Name | Price |\n| --- | --- |\n| Item | $10 |\n\nAfter`
      const blocks = splitMarkdownBlocks(markdown)

      expect(blocks).toHaveLength(3)
      expect(blocks[1]).toEqual({
        type: 'table',
        headers: ['Name', 'Price'],
        rows: [['Item', '$10']],
      })
    })

    it('falls back to markdown block for invalid table shape', () => {
      const markdown = `| A | B |\n| --- | --- |\n| 1 | 2 | 3 |`
      const blocks = splitMarkdownBlocks(markdown)

      expect(blocks).toEqual([{ type: 'markdown', content: markdown }])
    })
  })

  describe('buildColumnWidths', () => {
    it('builds bounded widths for headers and rows', () => {
      const widths = buildColumnWidths(['Label', 'Value'], [['Item', '$100']])
      expect(widths).toHaveLength(2)
      expect(widths[0]).toBeGreaterThanOrEqual(72)
      expect(widths[0]).toBeLessThanOrEqual(104)
      expect(widths[1]).toBeGreaterThanOrEqual(92)
      expect(widths[1]).toBeLessThanOrEqual(152)
    })

    it('returns empty array for no headers', () => {
      expect(buildColumnWidths([], [])).toEqual([])
    })
  })

  describe('buildColumnGrowthWeights', () => {
    it('assigns slower growth to first column and never below 1', () => {
      const weights = buildColumnGrowthWeights([100, 150, 200])
      expect(weights[0]).toBeLessThan(weights[1])
      expect(weights.every((weight) => weight >= 1)).toBe(true)
    })
  })
})
