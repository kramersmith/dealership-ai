import { XStack, YStack, Text } from 'tamagui'
import type { DealPhase } from '@/lib/types'
import { DEAL_PHASES } from '@/lib/constants'

interface CompactPhaseIndicatorProps {
  currentPhase: DealPhase
}

export function CompactPhaseIndicator({ currentPhase }: CompactPhaseIndicatorProps) {
  const currentIndex = DEAL_PHASES.findIndex((p) => p.key === currentPhase)
  const label = DEAL_PHASES[currentIndex]?.label ?? ''

  return (
    <XStack alignItems="center" gap="$2" flex={1}>
      <Text fontSize={11} fontWeight="600" color="$brand" numberOfLines={1}>
        {label}
      </Text>
      <XStack gap="$1" alignItems="center" flex={1}>
        {DEAL_PHASES.map((phase, i) => (
          <YStack
            key={phase.key}
            flex={i === currentIndex ? 2 : 1}
            height={4}
            borderRadius={2}
            backgroundColor={i <= currentIndex ? '$brand' : '$borderColor'}
          />
        ))}
      </XStack>
    </XStack>
  )
}
