import { useState, useRef, useEffect } from 'react'
import { Animated, TouchableOpacity } from 'react-native'
import { XStack, YStack, Text, useTheme } from 'tamagui'
import type { Scorecard, DealNumbers } from '@/lib/types'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { palette } from '@/lib/theme/tokens'
import { SCORE_DESCRIPTIONS } from '@/lib/constants'
import { StatusPill, AppCard } from '@/components/shared'

interface NegotiationScorecardProps {
  scorecard: Scorecard
  numbers: DealNumbers
}

interface ScoreItemProps {
  label: string
  descriptionKey: keyof Scorecard
  status: 'red' | 'yellow' | 'green' | null
}

function ScoreItem({ label, descriptionKey, status }: ScoreItemProps) {
  const [expanded, setExpanded] = useState(false)
  const scale = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (status) {
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.2, duration: 150, useNativeDriver: USE_NATIVE_DRIVER }),
        Animated.timing(scale, { toValue: 1, duration: 150, useNativeDriver: USE_NATIVE_DRIVER }),
      ]).start()
    }
  }, [status, scale])

  const description = SCORE_DESCRIPTIONS[descriptionKey]

  return (
    <TouchableOpacity
      onPress={() => setExpanded(!expanded)}
      activeOpacity={0.7}
      style={{ alignItems: 'center', minWidth: 44, minHeight: 44, justifyContent: 'center' }}
    >
      <Animated.View style={{ transform: [{ scale }], alignItems: 'center' }}>
        <YStack alignItems="center" gap="$1">
          <StatusPill status={status} size="sm" />
          <Text fontSize={10} color="$placeholderColor" fontWeight="500">
            {label}
          </Text>
          {expanded && description && (
            <Text
              fontSize={9}
              color="$placeholderColor"
              textAlign="center"
              lineHeight={12}
              maxWidth={70}
            >
              {description}
            </Text>
          )}
        </YStack>
      </Animated.View>
    </TouchableOpacity>
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
      ? ((theme.positive?.val as string) ?? palette.positive)
      : progressPercent <= 66
        ? ((theme.warning?.val as string) ?? palette.warning)
        : ((theme.danger?.val as string) ?? palette.danger)

  const animatedWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  })

  return (
    <AppCard compact gap="$3">
      <XStack justifyContent="space-around">
        <ScoreItem label="Price" descriptionKey="price" status={scorecard.price} />
        <ScoreItem label="Finance" descriptionKey="financing" status={scorecard.financing} />
        <ScoreItem label="Trade-In" descriptionKey="tradeIn" status={scorecard.tradeIn} />
        <ScoreItem label="Fees" descriptionKey="fees" status={scorecard.fees} />
        <ScoreItem label="Overall" descriptionKey="overall" status={scorecard.overall} />
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
