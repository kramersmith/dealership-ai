import { Animated } from 'react-native'
import { XStack, Text, useTheme } from 'tamagui'
import type { DealPhase } from '@/lib/types'
import { DEAL_PHASES } from '@/lib/constants'
import { useAnimatedNumber } from '@/hooks/useAnimatedValue'

interface CompactPhaseIndicatorProps {
  currentPhase: DealPhase
}

function PhaseBar({ active, current }: { active: boolean; current: boolean }) {
  const theme = useTheme()
  const flex = useAnimatedNumber(current ? 2 : 1, 300)
  const brandColor = theme.brand?.val as string
  const borderColor = theme.borderColor?.val as string

  return (
    <Animated.View
      style={{
        flex,
        height: 4,
        borderRadius: 2,
        backgroundColor: active ? brandColor : borderColor,
      }}
    />
  )
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
          <PhaseBar key={phase.key} active={i <= currentIndex} current={i === currentIndex} />
        ))}
      </XStack>
    </XStack>
  )
}
