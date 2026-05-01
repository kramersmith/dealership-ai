import { useCallback, useMemo } from 'react'
import { YStack, Text, Theme } from 'tamagui'
import { Scale } from '@tamagui/lucide-icons'
import type { ComparisonTable as ComparisonTableType, DealComparison } from '@/lib/types'
import { AppCard, ComparisonTable } from '@/components/shared'
import { palette } from '@/lib/theme/tokens'
import {
  insightCardBodyProps,
  insightCardEmphasisProps,
  insightCardSecondaryProps,
} from '@/lib/insightsPanelTypography'
import { CardTitle } from './CardTitle'
import { useDealStore } from '@/stores/dealStore'

interface AiComparisonCardProps {
  title: string
  content: Record<string, any>
}

export function AiComparisonCard({ title, content }: AiComparisonCardProps) {
  const comparison = content as unknown as DealComparison
  const { summary, recommendation, highlights = [] } = comparison

  const deals = useDealStore((s) => s.dealState?.deals ?? [])
  const vehicles = useDealStore((s) => s.dealState?.vehicles ?? [])

  const dealLabel = useCallback(
    (dealId: string | undefined, index: number) => {
      if (!dealId) {
        return index === 0 ? 'Option A' : index === 1 ? 'Option B' : `Option ${index + 1}`
      }
      const deal = deals.find((d) => d.id === dealId)
      const v = deal ? vehicles.find((x) => x.id === deal.vehicleId) : undefined
      if (v) {
        const core = [v.year, v.make, v.model].filter(Boolean).join(' ')
        const vin = v.vin
        const suffix = vin && vin.length >= 4 ? ` · …${vin.slice(-4)}` : ''
        return `${core || 'Option'}${suffix}`.trim()
      }
      return `Deal ${dealId.slice(0, 8)}…`
    },
    [deals, vehicles]
  )

  const table = useMemo<ComparisonTableType | null>(() => {
    if (highlights.length === 0) return null

    const optionIds: string[] = []
    for (const highlight of highlights) {
      for (const value of highlight.values) {
        if (!optionIds.includes(value.dealId)) {
          optionIds.push(value.dealId)
        }
      }
    }

    if (optionIds.length === 0) return null

    return {
      title,
      headers: ['', ...optionIds.map((dealId, index) => dealLabel(dealId, index))],
      rows: highlights.map((highlight) => [
        highlight.label,
        ...optionIds.map((dealId) => {
          const matchingValue = highlight.values.find((value) => value.dealId === dealId)
          return matchingValue?.value ?? '—'
        }),
      ]),
    }
  }, [dealLabel, highlights, title])

  const notes = useMemo(
    () =>
      highlights
        .filter((highlight) => highlight.note)
        .map((highlight) => `${highlight.label}: ${highlight.note}`),
    [highlights]
  )

  if (!table) return null

  return (
    <AppCard
      gap="$2"
      header={
        <CardTitle
          icon={<Scale size={12} color={palette.accentCyan} />}
          iconAccent={palette.accentCyan}
        >
          {title}
        </CardTitle>
      }
    >
      {summary ? <Text {...insightCardBodyProps}>{summary}</Text> : null}

      <ComparisonTable table={table} embedded />

      {notes.length > 0 ? (
        <YStack gap="$1.5">
          {notes.map((note) => (
            <Text key={note} {...insightCardSecondaryProps}>
              {note}
            </Text>
          ))}
        </YStack>
      ) : null}

      {recommendation ? (
        <Theme name="success">
          <YStack borderTopWidth={1} borderTopColor="$borderColor" paddingTop="$2.5" marginTop="$1">
            <Text {...insightCardEmphasisProps}>{recommendation}</Text>
          </YStack>
        </Theme>
      ) : null}
    </AppCard>
  )
}
