import { XStack, YStack, Text, Theme } from 'tamagui'
import type { DealComparison, ComparisonHighlight } from '@/lib/types'
import { AppCard } from '@/components/shared'
import { CardTitle } from './CardTitle'

interface AiComparisonCardProps {
  title: string
  content: Record<string, any>
}

function HighlightRow({ highlight }: { highlight: ComparisonHighlight }) {
  return (
    <YStack gap="$1.5" paddingVertical="$1.5">
      <Text fontSize={12} fontWeight="600" color="$placeholderColor">
        {highlight.label}
      </Text>
      <XStack gap="$3" flexWrap="wrap">
        {highlight.values.map((val) => (
          <YStack key={val.dealId} gap="$0.5">
            <Text
              fontSize={14}
              fontWeight={val.isWinner ? '700' : '400'}
              color={val.isWinner ? '$positive' : '$color'}
            >
              {val.value}
            </Text>
            <Text fontSize={12} color="$placeholderColor" numberOfLines={1}>
              {val.dealId}
            </Text>
          </YStack>
        ))}
      </XStack>
      {highlight.note && (
        <Text fontSize={12} color="$placeholderColor" fontStyle="italic" lineHeight={18}>
          {highlight.note}
        </Text>
      )}
    </YStack>
  )
}

export function AiComparisonCard({ title, content }: AiComparisonCardProps) {
  const comparison = content as unknown as DealComparison
  const { summary, recommendation, highlights } = comparison

  if (!highlights || highlights.length === 0) return null

  return (
    <AppCard compact gap="$2">
      <CardTitle>{title}</CardTitle>

      {summary && (
        <Text fontSize={13} color="$color" lineHeight={20}>
          {summary}
        </Text>
      )}

      <YStack>
        {highlights.map((highlight, i) => (
          <YStack key={highlight.label}>
            {i > 0 && <YStack height={1} backgroundColor="$borderColor" />}
            <HighlightRow highlight={highlight} />
          </YStack>
        ))}
      </YStack>

      {recommendation && (
        <Theme name="success">
          <YStack borderTopWidth={1} borderTopColor="$borderColor" paddingTop="$2.5" marginTop="$1">
            <Text fontSize={13} fontWeight="600" color="$color" lineHeight={20}>
              {recommendation}
            </Text>
          </YStack>
        </Theme>
      )}
    </AppCard>
  )
}
