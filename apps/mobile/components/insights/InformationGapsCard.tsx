import { useState } from 'react'
import { TouchableOpacity } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { ChevronDown, ChevronUp } from '@tamagui/lucide-icons'
import type { InformationGap, GapPriority } from '@/lib/types'
import { AppCard, SectionHeader } from '@/components/shared'

interface InformationGapsCardProps {
  gaps: InformationGap[]
}

const PRIORITY_COLORS: Record<GapPriority, { fill: string; border: string }> = {
  high: { fill: '$danger', border: '$danger' },
  medium: { fill: '$warning', border: '$warning' },
  low: { fill: 'transparent', border: '$placeholderColor' },
}

function GapRow({ gap }: { gap: InformationGap }) {
  const [expanded, setExpanded] = useState(false)
  const Icon = expanded ? ChevronUp : ChevronDown
  const colors = PRIORITY_COLORS[gap.priority]

  return (
    <TouchableOpacity
      onPress={() => setExpanded(!expanded)}
      activeOpacity={0.7}
      style={{ minHeight: 44 }}
    >
      <YStack
        backgroundColor="$backgroundStrong"
        borderRadius={10}
        paddingHorizontal="$3.5"
        paddingVertical="$3"
        gap={expanded ? '$2' : 0}
        borderWidth={1}
        borderColor="$borderColor"
      >
        <XStack alignItems="center" gap="$2">
          <YStack
            width={8}
            height={8}
            borderRadius={4}
            backgroundColor={colors.fill}
            borderWidth={gap.priority === 'low' ? 1 : 0}
            borderColor={colors.border}
          />
          <Text fontSize={13} color="$color" flex={1} lineHeight={20}>
            {gap.label}
          </Text>
          <Icon size={14} color="$placeholderColor" />
        </XStack>
        {expanded && (
          <Text fontSize={12} color="$placeholderColor" lineHeight={18} paddingLeft="$4">
            {gap.reason}
          </Text>
        )}
      </YStack>
    </TouchableOpacity>
  )
}

export function InformationGapsCard({ gaps }: InformationGapsCardProps) {
  if (gaps.length === 0) return null

  const sorted = [...gaps].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 }
    return order[a.priority] - order[b.priority]
  })

  return (
    <AppCard compact gap="$2">
      <SectionHeader title="Blind Spots" />
      {sorted.map((gap, index) => (
        <GapRow key={`${gap.label}-${index}`} gap={gap} />
      ))}
    </AppCard>
  )
}
