import { useRef, useEffect, useCallback, useState, useMemo, memo } from 'react'
import { Animated } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { BarChart3 } from '@tamagui/lucide-icons'
import { useFadeIn } from '@/hooks/useAnimatedValue'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import type { AiPanelCard, DealState, QuotedCard } from '@/lib/types'
import { useDealStore } from '@/stores/dealStore'
import { useChatStore } from '@/stores/chatStore'
import { AiCard } from './AiCard'
import { SituationBar } from './SituationBar'
import { ThinkingIndicator } from './ThinkingIndicator'

// ─── Timing ───

const EXIT_DURATION = 250
const ENTRANCE_DURATION = 300
const ENTRANCE_STAGGER = 80
const SLIDE_DISTANCE = 30
// ─── Panel Header ───

function PanelHeader({ thinking }: { thinking: boolean }) {
  return (
    <XStack alignItems="center" gap="$2" paddingBottom="$1">
      <BarChart3 size={14} color="$placeholderColor" />
      <Text fontSize={12} fontWeight="600" color="$placeholderColor" letterSpacing={0.5}>
        Insights
      </Text>
      {thinking && <ThinkingIndicator />}
    </XStack>
  )
}

// ─── Empty State ───

function EmptyState() {
  const opacity = useFadeIn(500)
  return (
    <Animated.View style={{ flex: 1, opacity }}>
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
    </Animated.View>
  )
}

// ─── Staggered Card ───

function StaggeredCard({
  card,
  index,
  onSendReply,
}: {
  card: AiPanelCard
  index: number
  onSendReply?: (text: string, quotedCard: QuotedCard) => Promise<void>
}) {
  const opacity = useRef(new Animated.Value(0)).current
  const translateX = useRef(new Animated.Value(-SLIDE_DISTANCE)).current

  useEffect(() => {
    const delay = index * ENTRANCE_STAGGER
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: ENTRANCE_DURATION,
        delay,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(translateX, {
        toValue: 0,
        duration: ENTRANCE_DURATION,
        delay,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]).start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Animated.View style={{ opacity, transform: [{ translateX }] }}>
      <AiCard card={card} onSendReply={onSendReply} />
    </Animated.View>
  )
}

// ─── Insights Panel ───

export const InsightsPanel = memo(function InsightsPanel({
  dealStateOverride,
}: {
  dealStateOverride?: DealState | null
}) {
  const storeDealState = useDealStore((s) => s.dealState)
  const dealState = dealStateOverride ?? storeDealState
  const cards = useMemo(() => dealState?.aiPanelCards ?? [], [dealState])
  const isSending = useChatStore((s) => s.isSending)

  // ─── Thinking indicator: stays until cards actually update ───
  const awaitingPanelUpdate = useRef(false)
  const thinkingCardsRef = useRef(cards)

  if (isSending && !awaitingPanelUpdate.current) {
    awaitingPanelUpdate.current = true
  }
  if (awaitingPanelUpdate.current && cards !== thinkingCardsRef.current && !isSending) {
    awaitingPanelUpdate.current = false
  }
  thinkingCardsRef.current = cards

  const showThinking = isSending || awaitingPanelUpdate.current

  // ─── Panel-level transition ───
  const [visibleCards, setVisibleCards] = useState<AiPanelCard[]>(cards)
  const [transitionKey, setTransitionKey] = useState(0)
  const exitOpacity = useRef(new Animated.Value(1)).current
  const exitTranslateX = useRef(new Animated.Value(0)).current
  const phaseRef = useRef<'idle' | 'exiting'>('idle')
  const pendingCardsRef = useRef<AiPanelCard[] | null>(null)
  const prevCardsRef = useRef<AiPanelCard[]>(cards)

  useEffect(() => {
    const prev = prevCardsRef.current
    prevCardsRef.current = cards

    // Same reference — no change
    if (cards === prev) return

    if (cards.length === 0 && visibleCards.length === 0) return

    if (cards.length === 0) {
      // Cards cleared — exit to empty
      phaseRef.current = 'exiting'
      exitOpacity.setValue(1)
      exitTranslateX.setValue(0)
      Animated.parallel([
        Animated.timing(exitOpacity, {
          toValue: 0,
          duration: EXIT_DURATION,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(exitTranslateX, {
          toValue: SLIDE_DISTANCE,
          duration: EXIT_DURATION,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]).start(({ finished }) => {
        if (finished) {
          setVisibleCards([])
          phaseRef.current = 'idle'
        }
      })
      return
    }

    if (visibleCards.length === 0) {
      // First cards — no exit needed, just enter
      setVisibleCards(cards)
      setTransitionKey((k) => k + 1)
      return
    }

    // Cards changed — exit old, then enter new
    if (phaseRef.current === 'exiting') {
      // Already exiting — just update pending
      pendingCardsRef.current = cards
      return
    }

    pendingCardsRef.current = cards
    phaseRef.current = 'exiting'
    exitOpacity.setValue(1)
    exitTranslateX.setValue(0)

    Animated.parallel([
      Animated.timing(exitOpacity, {
        toValue: 0,
        duration: EXIT_DURATION,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(exitTranslateX, {
        toValue: SLIDE_DISTANCE,
        duration: EXIT_DURATION,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]).start(({ finished }) => {
      if (finished && pendingCardsRef.current) {
        setVisibleCards(pendingCardsRef.current)
        setTransitionKey((k) => k + 1)
        pendingCardsRef.current = null
        phaseRef.current = 'idle'
        exitOpacity.setValue(1)
        exitTranslateX.setValue(0)
      }
    })
  }, [cards, visibleCards.length, exitOpacity, exitTranslateX])

  const handleSendReply = useCallback(async (text: string, quotedCard: QuotedCard) => {
    await useChatStore.getState().sendMessage(text, undefined, quotedCard)
  }, [])

  if (visibleCards.length === 0) {
    return (
      <YStack flex={1} paddingHorizontal="$3.5" paddingVertical="$3">
        <PanelHeader thinking={showThinking} />
        <EmptyState />
      </YStack>
    )
  }

  const negotiationContext = dealState?.negotiationContext ?? null

  return (
    <YStack flex={1} paddingHorizontal="$3.5" paddingTop="$3" gap="$3">
      <PanelHeader thinking={showThinking} />
      {negotiationContext?.situation && negotiationContext?.stance && (
        <SituationBar context={negotiationContext} />
      )}
      <Animated.View style={{ opacity: exitOpacity, transform: [{ translateX: exitTranslateX }] }}>
        <YStack gap="$3">
          {visibleCards.map((card, i) => (
            <StaggeredCard
              key={`${transitionKey}-${i}`}
              card={card}
              index={i}
              onSendReply={handleSendReply}
            />
          ))}
        </YStack>
      </Animated.View>
      <YStack height={24} />
    </YStack>
  )
})
