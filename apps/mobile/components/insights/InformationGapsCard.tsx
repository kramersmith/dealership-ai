import { useState } from 'react'
import { TouchableOpacity, Animated } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { ChevronDown, ChevronUp } from '@tamagui/lucide-icons'
import type { InformationGap } from '@/lib/types'
import { useFadeIn } from '@/hooks/useAnimatedValue'

interface InformationGapsCardProps {
  gaps: InformationGap[]
}

function GapRow({ gap }: { gap: InformationGap }) {
  const [expanded, setExpanded] = useState(false)
  const Icon = expanded ? ChevronUp : ChevronDown

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
          <Text fontSize={13} color="$color" flex={1} lineHeight={20}>
            {gap.label}
          </Text>
          <Icon size={14} color="$placeholderColor" />
        </XStack>
        {expanded && (
          <Text fontSize={12} color="$placeholderColor" lineHeight={18}>
            {gap.reason}
          </Text>
        )}
      </YStack>
    </TouchableOpacity>
  )
}

export function InformationGapsCard({ gaps }: InformationGapsCardProps) {
  const opacity = useFadeIn(300)

  if (gaps.length === 0) return null

  const sorted = [...gaps].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 }
    return order[a.priority] - order[b.priority]
  })

  return (
    <Animated.View style={{ opacity }}>
      <YStack gap="$2">
        <Text
          fontSize={12}
          fontWeight="600"
          color="$placeholderColor"
          textTransform="uppercase"
          letterSpacing={0.5}
          paddingHorizontal="$1"
        >
          What Would Help
        </Text>
        {sorted.map((gap, index) => (
          <GapRow key={`${gap.label}-${index}`} gap={gap} />
        ))}
      </YStack>
    </Animated.View>
  )
}
