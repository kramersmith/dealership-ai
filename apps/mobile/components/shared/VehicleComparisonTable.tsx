import { memo, useCallback, useState } from 'react'
import { ScrollView } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'

import type { ComparisonTable as ComparisonTableType } from '@/lib/types'
import { useScreenWidth } from '@/hooks/useScreenWidth'
import { AppCard } from './AppCard'
import { CardTitle } from '@/components/insights-panel/CardTitle'

interface ComparisonTableProps {
  table: ComparisonTableType
  /** Extra bottom margin (e.g. in chat column). */
  marginBottom?: string | number
  /** Render the table body without the outer card chrome/title. */
  embedded?: boolean
}

function isMetricHeader(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? ''
  return (
    normalized.length === 0 ||
    normalized === 'feature' ||
    normalized === 'features' ||
    normalized === 'metric' ||
    normalized === 'metrics' ||
    normalized === 'label' ||
    normalized === 'labels' ||
    normalized === 'attribute' ||
    normalized === 'attributes' ||
    normalized === 'spec' ||
    normalized === 'specs'
  )
}

export const ComparisonTable = memo(function ComparisonTable({
  table,
  marginBottom = '$2',
  embedded = false,
}: ComparisonTableProps) {
  const { headers, rows, title } = table
  const { width: screenWidth } = useScreenWidth()
  const [containerWidth, setContainerWidth] = useState<number | null>(null)
  const handleLayout = useCallback((event: { nativeEvent: { layout: { width: number } } }) => {
    const nextWidth = event.nativeEvent.layout.width
    setContainerWidth((currentWidth) =>
      currentWidth !== null && Math.abs(currentWidth - nextWidth) < 1 ? currentWidth : nextWidth
    )
  }, [])
  if (!headers.length) return null

  const hasMetricColumn = headers.length >= 2 && isMetricHeader(headers[0])
  const displayHeaders = hasMetricColumn ? headers : ['', ...headers]
  const displayRows = rows
    .map((row, index) => {
      if (hasMetricColumn) return row
      return [`Row ${index + 1}`, ...row]
    })
    .filter((row) => row.slice(1).some((value) => value && value !== '—'))
  const optionCount = Math.max(displayHeaders.length - 1, 1)

  const columnMinWidths = displayHeaders.map((_, index) => {
    if (index === 0) return optionCount <= 2 ? 96 : 104
    return optionCount <= 2 ? 150 : 168
  })
  const totalMinWidth = columnMinWidths.reduce((sum, width) => sum + width, 0)
  const optionHeaders = displayHeaders.slice(1)
  const availableWidth = containerWidth ?? screenWidth
  const shouldUseMobileLayout = availableWidth < totalMinWidth
  const desktopTableWidth = Math.max(totalMinWidth, availableWidth)
  const desktopColumnWidths = (() => {
    const widths = [...columnMinWidths]
    const extraWidth = desktopTableWidth - totalMinWidth
    if (extraWidth <= 0 || widths.length <= 1) return widths

    const extraPerOptionColumn = extraWidth / (widths.length - 1)
    return widths.map((width, index) => (index === 0 ? width : width + extraPerOptionColumn))
  })()

  const desktopTableBody = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <YStack
        width={desktopTableWidth}
        minWidth={totalMinWidth}
        borderWidth={1}
        borderColor="$borderColor"
        borderRadius="$3"
        overflow="hidden"
        backgroundColor="$background"
      >
        <XStack
          backgroundColor="$backgroundHover"
          borderBottomWidth={1}
          borderBottomColor="$borderColor"
        >
          {displayHeaders.map((header, index) => (
            <YStack
              key={`header-${index}`}
              width={desktopColumnWidths[index]}
              paddingHorizontal="$2.5"
              paddingVertical="$2.5"
              borderRightWidth={index < displayHeaders.length - 1 ? 1 : 0}
              borderRightColor="$borderColor"
              justifyContent="flex-start"
              flexShrink={0}
            >
              <Text
                fontSize={index === 0 ? 11 : 12}
                fontWeight="600"
                color="$placeholderColor"
                textTransform={index === 0 ? undefined : 'uppercase'}
                letterSpacing={index === 0 ? 0 : 0.4}
                lineHeight={18}
              >
                {header || ' '}
              </Text>
            </YStack>
          ))}
        </XStack>

        {displayRows.map((row, rowIndex) => (
          <XStack
            key={`row-${rowIndex}`}
            backgroundColor={rowIndex % 2 === 0 ? '$background' : '$backgroundStrong'}
            borderTopWidth={rowIndex > 0 ? 1 : 0}
            borderTopColor="$borderColor"
          >
            {displayHeaders.map((_, columnIndex) => (
              <YStack
                key={`cell-${rowIndex}-${columnIndex}`}
                width={desktopColumnWidths[columnIndex]}
                paddingHorizontal="$2.5"
                paddingVertical="$2.5"
                borderRightWidth={columnIndex < displayHeaders.length - 1 ? 1 : 0}
                borderRightColor="$borderColor"
                justifyContent="flex-start"
                flexShrink={0}
              >
                <Text
                  fontSize={columnIndex === 0 ? 12 : 13}
                  fontWeight={columnIndex === 0 ? '600' : '500'}
                  color={columnIndex === 0 ? '$placeholderColor' : '$color'}
                  lineHeight={19}
                >
                  {row[columnIndex] ?? '—'}
                </Text>
              </YStack>
            ))}
          </XStack>
        ))}
      </YStack>
    </ScrollView>
  )

  const mobileTableBody = (
    <YStack borderWidth={1} borderColor="$borderColor" borderRadius="$3" overflow="hidden">
      {displayRows.map((row, rowIndex) => (
        <YStack
          key={`mobile-row-${rowIndex}`}
          backgroundColor={rowIndex % 2 === 0 ? '$background' : '$backgroundStrong'}
          borderTopWidth={rowIndex > 0 ? 1 : 0}
          borderTopColor="$borderColor"
          paddingHorizontal="$3"
          paddingVertical="$3"
          gap="$2.5"
        >
          <Text
            fontSize={11}
            fontWeight="700"
            color="$placeholderColor"
            textTransform="uppercase"
            letterSpacing={0.4}
          >
            {row[0] ?? 'Metric'}
          </Text>

          <YStack gap="$2">
            {optionHeaders.map((header, optionIndex) => (
              <XStack
                key={`mobile-cell-${rowIndex}-${optionIndex}`}
                justifyContent="space-between"
                alignItems="flex-start"
                gap="$3"
              >
                <Text
                  flex={1}
                  fontSize={12}
                  fontWeight="600"
                  color="$placeholderColor"
                  lineHeight={18}
                >
                  {header}
                </Text>
                <Text
                  flex={1}
                  fontSize={13}
                  fontWeight="600"
                  color="$color"
                  lineHeight={19}
                  textAlign="right"
                >
                  {row[optionIndex + 1] ?? '—'}
                </Text>
              </XStack>
            ))}
          </YStack>
        </YStack>
      ))}
    </YStack>
  )

  const tableBody = shouldUseMobileLayout ? mobileTableBody : desktopTableBody

  const measuredTable = (
    <YStack width="100%" onLayout={handleLayout}>
      {tableBody}
    </YStack>
  )

  if (embedded) {
    return measuredTable
  }

  return (
    <YStack paddingHorizontal="$3" marginBottom={marginBottom}>
      <AppCard compact>
        <YStack gap="$2.5">
          <CardTitle>{title?.trim() ? title : 'Comparison'}</CardTitle>
          {measuredTable}
        </YStack>
      </AppCard>
    </YStack>
  )
})
