import { useRef, useEffect } from 'react'
import { Animated } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import type { NegotiationContext, NegotiationStance } from '@/lib/types'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { insightCardBodyProps } from '@/lib/insightsPanelTypography'
import { CardTitle } from './CardTitle'

interface SituationBarProps {
  context: NegotiationContext
  /**
   * `panel` — standalone strip (insights header / legacy).
   * `insightCard` — same typography rhythm as other AiCards: CardTitle row + body.
   */
  layout?: 'panel' | 'insightCard'
  /** Uppercase title row when `layout="insightCard"` (e.g. backend phase card title). */
  cardTitle?: string
}

const STANCE_COLORS: Record<NegotiationStance, string> = {
  researching: '$brand',
  preparing: '$brand',
  engaging: '$brand',
  negotiating: '$brand',
  holding: '$warning',
  walking: '$warning',
  waiting: '$warning',
  financing: '$positive',
  closing: '$positive',
  post_purchase: '$positive',
}

const STANCE_LABELS: Record<NegotiationStance, string> = {
  researching: 'Researching',
  preparing: 'Preparing',
  engaging: 'Engaging',
  negotiating: 'Negotiating',
  holding: 'Holding',
  walking: 'Walked Away',
  waiting: 'Waiting',
  financing: 'Financing',
  closing: 'Closing',
  post_purchase: 'Complete',
}

const CROSSFADE_DURATION = 300
const SLIDE_DISTANCE = 20

export function SituationBar({
  context,
  layout = 'panel',
  cardTitle = 'Status',
}: SituationBarProps) {
  const color = STANCE_COLORS[context.stance] ?? '$placeholderColor'
  const label = STANCE_LABELS[context.stance] ?? context.stance
  const fadeAnim = useRef(new Animated.Value(0)).current
  const slideX = useRef(new Animated.Value(0)).current
  const prevStance = useRef(context.stance)
  const prevSituation = useRef(context.situation)

  useEffect(() => {
    const stanceChanged = prevStance.current !== context.stance
    const situationChanged = prevSituation.current !== context.situation

    // Reset fade on stance change (full bar crossfade)
    if (stanceChanged) {
      fadeAnim.setValue(0)
      prevStance.current = context.stance
    }

    // Reset slide on situation text change
    if (situationChanged) {
      slideX.setValue(SLIDE_DISTANCE)
      prevSituation.current = context.situation
    }

    const animations: Animated.CompositeAnimation[] = [
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: CROSSFADE_DURATION,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]

    // Only animate slide if situation actually changed
    if (situationChanged) {
      animations.push(
        Animated.timing(slideX, {
          toValue: 0,
          duration: CROSSFADE_DURATION,
          useNativeDriver: USE_NATIVE_DRIVER,
        })
      )
    }

    Animated.parallel(animations).start()
  }, [context.stance, context.situation, fadeAnim, slideX])

  const stancePill = (
    <XStack
      backgroundColor={color}
      borderRadius={6}
      paddingHorizontal="$2.5"
      paddingVertical="$1"
      flexShrink={0}
    >
      <Text fontSize={10} fontWeight="700" color="$white" textTransform="uppercase">
        {label}
      </Text>
    </XStack>
  )

  if (layout === 'insightCard') {
    return (
      <Animated.View style={{ opacity: fadeAnim }}>
        <YStack gap="$2">
          <CardTitle right={stancePill}>{cardTitle}</CardTitle>
          <Animated.View style={{ transform: [{ translateX: slideX }] }}>
            <Text {...insightCardBodyProps}>{context.situation}</Text>
          </Animated.View>
        </YStack>
      </Animated.View>
    )
  }

  return (
    <Animated.View style={{ opacity: fadeAnim }}>
      <YStack
        backgroundColor="$backgroundHover"
        borderRadius={10}
        paddingHorizontal="$3"
        paddingVertical="$2.5"
        gap="$1.5"
      >
        <XStack>{stancePill}</XStack>
        <Animated.View style={{ transform: [{ translateX: slideX }] }}>
          <Text {...insightCardBodyProps}>{context.situation}</Text>
        </Animated.View>
      </YStack>
    </Animated.View>
  )
}
