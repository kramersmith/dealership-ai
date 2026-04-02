import { useRef, useEffect } from 'react'
import { Animated } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import type { NegotiationContext, NegotiationStance } from '@/lib/types'
import { USE_NATIVE_DRIVER } from '@/lib/platform'

interface SituationBarProps {
  context: NegotiationContext
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

export function SituationBar({ context }: SituationBarProps) {
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

  return (
    <Animated.View style={{ opacity: fadeAnim }}>
      <YStack
        backgroundColor="$backgroundHover"
        borderRadius={10}
        paddingHorizontal="$3"
        paddingVertical="$2.5"
        gap="$1.5"
      >
        <XStack>
          <XStack
            backgroundColor={color}
            borderRadius={4}
            paddingHorizontal="$1.5"
            paddingVertical="$0.5"
          >
            <Text fontSize={10} fontWeight="700" color="$white" textTransform="uppercase">
              {label}
            </Text>
          </XStack>
        </XStack>
        <Animated.View style={{ transform: [{ translateX: slideX }] }}>
          <Text fontSize={12} color="$color" lineHeight={18}>
            {context.situation}
          </Text>
        </Animated.View>
      </YStack>
    </Animated.View>
  )
}
