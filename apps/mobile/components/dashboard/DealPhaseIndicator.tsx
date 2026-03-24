import { XStack, YStack, Text } from 'tamagui'
import type { DealPhase } from '@/lib/types'
import { DEAL_PHASES } from '@/lib/constants'
import { colors } from '@/lib/colors'

interface DealPhaseIndicatorProps {
  currentPhase: DealPhase
}

export function DealPhaseIndicator({ currentPhase }: DealPhaseIndicatorProps) {
  const currentIndex = DEAL_PHASES.findIndex((p) => p.key === currentPhase)

  return (
    <XStack justifyContent="space-between" alignItems="center" gap="$1">
      {DEAL_PHASES.map((phase, index) => {
        const isCompleted = index < currentIndex
        const isCurrent = index === currentIndex
        const isFuture = index > currentIndex

        return (
          <YStack key={phase.key} flex={1} alignItems="center" gap="$1">
            <XStack alignItems="center" width="100%">
              {index > 0 && (
                <XStack
                  flex={1}
                  height={2}
                  backgroundColor={isCompleted || isCurrent ? colors.brand : '$borderColor'}
                  marginRight={-2}
                />
              )}
              <XStack
                width={isCurrent ? 12 : 8}
                height={isCurrent ? 12 : 8}
                borderRadius={100}
                backgroundColor={
                  isCompleted ? colors.brand : isCurrent ? colors.brand : '$borderColor'
                }
                borderWidth={isCurrent ? 2 : 0}
                borderColor={isCurrent ? colors.brandLight : undefined}
              />
              {index < DEAL_PHASES.length - 1 && (
                <XStack
                  flex={1}
                  height={2}
                  backgroundColor={isCompleted ? colors.brand : '$borderColor'}
                  marginLeft={-2}
                />
              )}
            </XStack>
            <Text
              fontSize={10}
              fontWeight={isCurrent ? '700' : '400'}
              color={isCurrent ? colors.brand : isFuture ? '$placeholderColor' : '$color'}
              textAlign="center"
              numberOfLines={1}
            >
              {phase.label}
            </Text>
          </YStack>
        )
      })}
    </XStack>
  )
}
