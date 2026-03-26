import { useRef, useEffect } from 'react'
import { Animated } from 'react-native'
import { XStack, YStack, Text, useTheme } from 'tamagui'
import type { Scorecard, DealNumbers } from '@/lib/types'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { StatusPill, AppCard } from '@/components/shared'

interface NegotiationScorecardProps {
  scorecard: Scorecard
  numbers: DealNumbers
}

interface ScoreItemProps {
  label: string
  status: 'red' | 'yellow' | 'green' | null
}

function ScoreItem({ label, status }: ScoreItemProps) {
  const scale = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (status) {
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.2, duration: 150, useNativeDriver: USE_NATIVE_DRIVER }),
        Animated.timing(scale, { toValue: 1, duration: 150, useNativeDriver: USE_NATIVE_DRIVER }),
      ]).start()
    }
  }, [status, scale])

  return (
    <Animated.View style={{ transform: [{ scale }], alignItems: 'center' }}>
      <YStack alignItems="center" gap="$1">
        <StatusPill status={status} size="sm" />
        <Text fontSize={10} color="$placeholderColor" fontWeight="500">
          {label}
        </Text>
      </YStack>
    </Animated.View>
  )
}

export function NegotiationScorecard({ scorecard, numbers }: NegotiationScorecardProps) {
  const { yourTarget, currentOffer, walkAwayPrice } = numbers
  const progressAnim = useRef(new Animated.Value(50)).current
  const theme = useTheme()

  let progressPercent = 50
  if (
    yourTarget !== null &&
    walkAwayPrice !== null &&
    currentOffer !== null &&
    walkAwayPrice > yourTarget
  ) {
    const range = walkAwayPrice - yourTarget
    const position = currentOffer - yourTarget
    progressPercent = Math.max(0, Math.min(100, (position / range) * 100))
  }

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: 100 - progressPercent,
      duration: 500,
      useNativeDriver: false,
    }).start()
  }, [progressPercent, progressAnim])

  const progressColor =
    progressPercent <= 33
      ? ((theme.positive?.val as string) ?? '#22C55E')
      : progressPercent <= 66
        ? ((theme.warning?.val as string) ?? '#EAB308')
        : ((theme.danger?.val as string) ?? '#EF4444')

  const animatedWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  })

  return (
    <AppCard gap="$3">
      <XStack justifyContent="space-around">
        <ScoreItem label="Price" status={scorecard.price} />
        <ScoreItem label="Finance" status={scorecard.financing} />
        <ScoreItem label="Trade-In" status={scorecard.tradeIn} />
        <ScoreItem label="Fees" status={scorecard.fees} />
        <ScoreItem label="Overall" status={scorecard.overall} />
      </XStack>

      {yourTarget !== null && currentOffer !== null && (
        <YStack gap="$1">
          <XStack height={6} backgroundColor="$borderColor" borderRadius={100} overflow="hidden">
            <Animated.View
              style={{
                width: animatedWidth,
                height: '100%',
                backgroundColor: progressColor,
                borderRadius: 100,
              }}
            />
          </XStack>
          <XStack justifyContent="space-between">
            <Text fontSize={10} color="$positive" fontWeight="600">
              Target
            </Text>
            <Text fontSize={10} color="$placeholderColor" fontWeight="500">
              Current
            </Text>
            <Text fontSize={10} color="$danger" fontWeight="600">
              Walk-Away
            </Text>
          </XStack>
        </YStack>
      )}
    </AppCard>
  )
}
