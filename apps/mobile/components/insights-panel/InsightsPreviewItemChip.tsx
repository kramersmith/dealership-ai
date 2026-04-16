import { Text, Theme, XStack, YStack } from 'tamagui'
import { STATUS_LABELS, STATUS_THEMES } from '@/lib/constants'
import type { InsightsPreviewItem } from '@/lib/insightsCollapsedPreview'

interface InsightsPreviewItemChipProps {
  item: InsightsPreviewItem
}

/**
 * Renders a single preview row inside the collapsed insights strip.
 * Shape varies by item type — health gets a status dot + label, flag gets a danger
 * label, savings/text get a colored label, flag count gets a small pill.
 */
export function InsightsPreviewItemChip({ item }: InsightsPreviewItemChipProps) {
  switch (item.type) {
    case 'health':
      return (
        <XStack alignItems="center" gap="$1.5">
          <Theme name={STATUS_THEMES[item.status]}>
            <YStack width={8} height={8} borderRadius={4} backgroundColor="$color" />
          </Theme>
          <Text fontSize={13} fontWeight="700" color="$color" numberOfLines={1}>
            {STATUS_LABELS[item.status]}
          </Text>
        </XStack>
      )
    case 'flag':
      return (
        <Text fontSize={12} fontWeight="700" color="$danger" numberOfLines={1} flex={1}>
          {item.label}
        </Text>
      )
    case 'savings':
      return (
        <Text fontSize={13} fontWeight="700" color="$positive" numberOfLines={1}>
          {item.label}
        </Text>
      )
    case 'flagCount':
      return (
        <XStack
          backgroundColor="$danger"
          borderRadius={8}
          paddingHorizontal={6}
          paddingVertical={1}
        >
          <Text fontSize={10} fontWeight="700" color="$white">
            {item.count}
          </Text>
        </XStack>
      )
    case 'text':
      return (
        <Text fontSize={13} fontWeight="700" lineHeight={18} color="$color" numberOfLines={1}>
          {item.label}
        </Text>
      )
  }
}
