import { useRef, useEffect, useCallback, memo } from 'react'
import { Animated } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { BarChart3 } from '@tamagui/lucide-icons'
import type { AiPanelCard, QuotedCard } from '@/lib/types'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { useDealStore } from '@/stores/dealStore'
import { useChatStore } from '@/stores/chatStore'
import { AiCard } from './AiCard'
import { SituationBar } from './SituationBar'

/** Animate a card sliding in. Only animates on first mount. */
const AnimatedCard = memo(function AnimatedCard({
  index,
  card,
  skipAnimation,
  onSendReply,
}: {
  index: number
  card: AiPanelCard
  skipAnimation: boolean
  onSendReply?: (text: string, quotedCard: QuotedCard) => Promise<void>
}) {
  const opacity = useRef(new Animated.Value(skipAnimation ? 1 : 0)).current
  const translateY = useRef(new Animated.Value(skipAnimation ? 0 : 10)).current

  useEffect(() => {
    if (skipAnimation) return

    const delay = index * 60
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 280,
        delay,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 280,
        delay,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]).start()
  }, [opacity, translateY, index, skipAnimation])

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <AiCard card={card} onSendReply={onSendReply} />
    </Animated.View>
  )
})

function PanelHeader() {
  return (
    <XStack alignItems="center" gap="$2" paddingBottom="$1">
      <BarChart3 size={14} color="$placeholderColor" />
      <Text fontSize={12} fontWeight="600" color="$placeholderColor" letterSpacing={0.5}>
        Insights
      </Text>
    </XStack>
  )
}

function EmptyState() {
  return (
    <YStack flex={1} alignItems="center" justifyContent="center" gap="$3" padding="$4">
      <BarChart3 size={28} color="$placeholderColor" opacity={0.5} />
      <YStack gap="$1.5" alignItems="center">
        <Text fontSize={14} fontWeight="600" color="$color" textAlign="center">
          No insights yet
        </Text>
        <Text fontSize={13} color="$placeholderColor" textAlign="center" lineHeight={20}>
          Share details about your deal and your AI advisor will surface key insights here.
        </Text>
      </YStack>
    </YStack>
  )
}

/** The InsightsPanel subscribes directly to aiPanelCards from the deal store. */
export const InsightsPanel = memo(function InsightsPanel() {
  const dealState = useDealStore((s) => s.dealState)
  const cards = dealState?.aiPanelCards ?? []
  const hasAnimatedOnce = useRef(false)

  // Only animate the first time cards appear — subsequent updates render immediately
  const skipAnimation = hasAnimatedOnce.current
  if (cards.length > 0 && !hasAnimatedOnce.current) {
    hasAnimatedOnce.current = true
  }

  const handleSendReply = useCallback(async (text: string, quotedCard: QuotedCard) => {
    await useChatStore.getState().sendMessage(text, undefined, quotedCard)
  }, [])

  if (cards.length === 0) {
    return (
      <YStack flex={1} paddingHorizontal="$3.5" paddingVertical="$3">
        <PanelHeader />
        <EmptyState />
      </YStack>
    )
  }

  const negotiationContext = dealState?.negotiationContext ?? null

  return (
    <YStack flex={1} paddingHorizontal="$3.5" paddingTop="$3" gap="$3">
      <PanelHeader />
      {negotiationContext?.situation && negotiationContext?.stance && (
        <SituationBar context={negotiationContext} />
      )}
      {cards.map((card, i) => (
        <AnimatedCard
          key={`panel-card-${i}`}
          index={i}
          card={card}
          skipAnimation={skipAnimation}
          onSendReply={handleSendReply}
        />
      ))}
      <YStack height={24} />
    </YStack>
  )
})
