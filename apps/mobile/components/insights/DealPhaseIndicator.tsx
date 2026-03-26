import { Animated } from 'react-native'
import { XStack, YStack, Text } from 'tamagui'
import type { DealPhase } from '@/lib/types'
import { DEAL_PHASES } from '@/lib/constants'
import { useFadeIn } from '@/hooks/useAnimatedValue'

interface DealPhaseIndicatorProps {
  currentPhase: DealPhase
}

export function DealPhaseIndicator({ currentPhase }: DealPhaseIndicatorProps) {
  const currentIndex = DEAL_PHASES.findIndex((phase) => phase.key === currentPhase)
  const opacity = useFadeIn(300)

  return (
    <Animated.View style={{ opacity }}>
      <YStack
        backgroundColor="$backgroundStrong"
        borderRadius={12}
        padding="$3"
        borderWidth={1}
        borderColor="$borderColor"
      >
        {DEAL_PHASES.map((phase, index) => {
          const isCompleted = index < currentIndex
          const isCurrent = index === currentIndex
          const isFuture = index > currentIndex
          const isLast = index === DEAL_PHASES.length - 1

          return (
            <XStack key={phase.key} gap="$3">
              {/* Rail column: dot + connector */}
              <YStack alignItems="center" width={20}>
                {/* Dot */}
                <YStack alignItems="center" justifyContent="center" width={20} height={20}>
                  {isCurrent ? (
                    <YStack
                      width={20}
                      height={20}
                      borderRadius={10}
                      backgroundColor="$brand"
                      opacity={0.2}
                      position="absolute"
                    />
                  ) : null}
                  <YStack
                    width={isCurrent ? 10 : isCompleted ? 8 : 6}
                    height={isCurrent ? 10 : isCompleted ? 8 : 6}
                    borderRadius={100}
                    backgroundColor={isCompleted || isCurrent ? '$brand' : '$borderColor'}
                  />
                </YStack>
                {/* Connector line */}
                {!isLast && (
                  <YStack
                    flex={1}
                    width={2}
                    borderRadius={1}
                    backgroundColor={isCompleted ? '$brand' : '$borderColor'}
                    minHeight={16}
                  />
                )}
              </YStack>

              {/* Label */}
              <YStack justifyContent="center" paddingBottom={isLast ? 0 : '$2'} flex={1}>
                <Text
                  fontSize={13}
                  fontWeight={isCurrent ? '700' : '500'}
                  color={isCurrent ? '$brand' : isFuture ? '$placeholderColor' : '$color'}
                  lineHeight={20}
                >
                  {phase.label}
                </Text>
              </YStack>
            </XStack>
          )
        })}
      </YStack>
    </Animated.View>
  )
}
