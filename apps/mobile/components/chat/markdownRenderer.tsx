import { Fragment } from 'react'
import { ScrollView, View, Text, type StyleSheet } from 'react-native'
import Markdown, { MarkdownIt, type RenderRules } from 'react-native-markdown-display'
import { YStack } from 'tamagui'
import { CopyableBlock } from './CopyableBlock'
import { extractTextFromNode } from './markdownUtils'
import {
  buildColumnGrowthWeights,
  buildColumnWidths,
  splitMarkdownBlocks,
} from './markdownTableUtils'

const chatMarkdownIt = MarkdownIt({
  typographer: true,
}).enable(['table'])

function renderTableRow(
  key: string,
  cells: string[],
  columnWidths: number[],
  styles: any,
  options: { isHeader: boolean; isLastRow: boolean }
) {
  const textStyle = options.isHeader ? styles.tableHeaderText : styles.tableBodyText
  const growthWeights = buildColumnGrowthWeights(columnWidths)
  const totalGrowthWeight = growthWeights.reduce((sum, width) => sum + width, 0)

  return (
    <View key={key} style={[styles.tr, options.isLastRow ? styles.tableRowLast : null]}>
      {cells.map((cellText, index) => (
        <View
          key={`${key}-cell-${index}`}
          style={[
            styles.tableCell,
            options.isHeader ? styles.tableHeaderCell : styles.tableBodyCell,
            index === cells.length - 1 ? styles.tableCellLast : null,
            {
              minWidth: columnWidths[index],
              flexBasis: columnWidths[index],
              flexGrow: totalGrowthWeight > 0 ? growthWeights[index] / totalGrowthWeight : 1,
              flexShrink: 0,
            },
          ]}
        >
          <Text style={[textStyle, index === 0 ? styles.tableLabelText : null]}>
            {renderInlineMarkdown(cellText, styles, `${key}-text-${index}`)}
          </Text>
        </View>
      ))}
    </View>
  )
}

function renderInlineMarkdown(source: string, styles: any, keyPrefix: string) {
  const parts = source.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|_[^_]+_)/g)

  return parts
    .filter((part) => part.length > 0)
    .map((part, index) => {
      const key = `${keyPrefix}-${index}`

      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <Text key={key} style={styles.strong}>
            {part.slice(2, -2)}
          </Text>
        )
      }

      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <Text key={key} style={styles.code_inline}>
            {part.slice(1, -1)}
          </Text>
        )
      }

      if (
        (part.startsWith('*') && part.endsWith('*')) ||
        (part.startsWith('_') && part.endsWith('_'))
      ) {
        return (
          <Text key={key} style={styles.em}>
            {part.slice(1, -1)}
          </Text>
        )
      }

      return <Fragment key={key}>{part}</Fragment>
    })
}

function renderMarkdownBlock(content: string, style: StyleSheet.NamedStyles<any>) {
  return (
    <Markdown markdownit={chatMarkdownIt} style={style} rules={chatMarkdownRules}>
      {content}
    </Markdown>
  )
}

function MarkdownTable({
  headers,
  rows,
  styles,
}: {
  headers: string[]
  rows: string[][]
  styles: any
}) {
  const columnWidths = buildColumnWidths(headers, rows)
  const totalBaseWidth = columnWidths.reduce((sum, width) => sum + width, 0)

  return (
    <ScrollView
      horizontal
      bounces={false}
      showsHorizontalScrollIndicator
      style={styles.tableScroll as any}
      contentContainerStyle={styles.tableScrollContent as any}
    >
      <YStack
        style={[
          styles.table as any,
          {
            width: totalBaseWidth,
            minWidth: '100%',
          },
        ]}
      >
        {renderTableRow('thead', headers, columnWidths, styles, {
          isHeader: true,
          isLastRow: rows.length === 0,
        })}
        {rows.map((row, rowIndex) =>
          renderTableRow(`tbody-${rowIndex}`, row, columnWidths, styles, {
            isHeader: false,
            isLastRow: rowIndex === rows.length - 1,
          })
        )}
      </YStack>
    </ScrollView>
  )
}

export const chatMarkdownRules: RenderRules = {
  blockquote: (node, children) => (
    <CopyableBlock key={node.key} text={extractTextFromNode(node)}>
      {children}
    </CopyableBlock>
  ),
}

interface ChatMarkdownProps {
  children: string
  style: StyleSheet.NamedStyles<any>
}

export function ChatMarkdown({ children, style }: ChatMarkdownProps) {
  const blocks = splitMarkdownBlocks(children)

  return (
    <YStack>
      {blocks.map((block, index) => (
        <Fragment key={`markdown-block-${index}`}>
          {block.type === 'markdown' ? (
            renderMarkdownBlock(block.content, style)
          ) : (
            <MarkdownTable headers={block.headers} rows={block.rows} styles={style} />
          )}
        </Fragment>
      ))}
    </YStack>
  )
}
