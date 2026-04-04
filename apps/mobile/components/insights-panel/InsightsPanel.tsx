import { useRef, useEffect, useCallback, useMemo, memo, useState } from 'react'
import { Animated, Easing } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { BarChart3 } from '@tamagui/lucide-icons'
import Reanimated, { FadeInLeft, LinearTransition, SlideOutRight } from 'react-native-reanimated'
import { useFadeIn } from '@/hooks/useAnimatedValue'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import type { AiPanelCard, DealState, QuotedCard } from '@/lib/types'
import { useDealStore } from '@/stores/dealStore'
import { useChatStore } from '@/stores/chatStore'
import { AiCard } from './AiCard'
import { SituationBar } from './SituationBar'
import { ThinkingIndicator } from './ThinkingIndicator'

// ─── Timing ───

const ENTRANCE_DURATION = 200
const ENTRANCE_STAGGER = 22
const EXIT_DURATION = 170
const UPDATE_FADE_OUT_MS = 90
const UPDATE_FADE_IN_MS = 140

function stableCardSignature(card: AiPanelCard): string {
  return `${card.type}|${card.title}|${card.priority}|${JSON.stringify(card.content ?? {})}`
}

function buildIdentityKey(cardType: AiPanelCard['type'], occurrence: number): string {
  // Identity should ignore mutable card content/title so replacements animate in-place.
  return `${cardType}#${occurrence}`
}

interface RenderCard {
  id: string
  identity: string
  signature: string
  card: AiPanelCard
}
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

// ─── Animated Card ───

function AnimatedCard({
  cardId,
  card,
  index,
  signature,
  isGrowthActive,
  onGrowthDone,
  onSendReply,
}: {
  cardId: string
  card: AiPanelCard
  index: number
  signature: string
  isGrowthActive: boolean
  onGrowthDone: (cardId: string) => void
  onSendReply?: (text: string, quotedCard: QuotedCard) => Promise<void>
}) {
  const [visibleCard, setVisibleCard] = useState(card)
  const [outgoingCard, setOutgoingCard] = useState<AiPanelCard | null>(null)
  const visibleCardRef = useRef(card)
  const incomingTranslateX = useRef(new Animated.Value(0)).current
  const outgoingTranslateX = useRef(new Animated.Value(0)).current
  const outgoingOpacity = useRef(new Animated.Value(0)).current
  const displayedSignatureRef = useRef(signature)
  const pendingRef = useRef<{ card: AiPanelCard; signature: string } | null>(null)

  const cardLayoutTransition = useMemo(
    () => LinearTransition.springify().damping(22).stiffness(210).mass(0.7),
    []
  )

  const entering = useMemo(
    () => FadeInLeft.duration(ENTRANCE_DURATION).delay(index * ENTRANCE_STAGGER),
    [index]
  )

  const exiting = useMemo(() => SlideOutRight.duration(EXIT_DURATION), [])

  const runGrowthTransition = useCallback(
    (nextCard: AiPanelCard, nextSignature: string) => {
      const currentCard = visibleCardRef.current

      // Keep outgoing card fixed in place while the incoming card takes layout.
      setOutgoingCard(currentCard)
      setVisibleCard(nextCard)
      visibleCardRef.current = nextCard
      displayedSignatureRef.current = nextSignature

      incomingTranslateX.setValue(-18)
      outgoingTranslateX.setValue(0)
      outgoingOpacity.setValue(1)

      Animated.parallel([
        Animated.timing(incomingTranslateX, {
          toValue: 0,
          duration: UPDATE_FADE_IN_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(outgoingTranslateX, {
          toValue: 18,
          duration: UPDATE_FADE_OUT_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(outgoingOpacity, {
          toValue: 0,
          duration: UPDATE_FADE_OUT_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]).start(() => {
        setOutgoingCard(null)
        onGrowthDone(cardId)
      })
    },
    [cardId, incomingTranslateX, onGrowthDone, outgoingOpacity, outgoingTranslateX]
  )

  useEffect(() => {
    if (displayedSignatureRef.current === signature) {
      // Keep local card in sync when no queued growth transition is needed.
      setVisibleCard(card)
      visibleCardRef.current = card
      return
    }

    pendingRef.current = { card, signature }
    if (isGrowthActive) {
      const pending = pendingRef.current
      if (pending) {
        pendingRef.current = null
        runGrowthTransition(pending.card, pending.signature)
      }
    }
  }, [card, isGrowthActive, runGrowthTransition, signature])

  return (
    <Reanimated.View entering={entering} exiting={exiting} layout={cardLayoutTransition}>
      <YStack position="relative">
        <Animated.View style={{ transform: [{ translateX: incomingTranslateX }] }}>
          <AiCard card={visibleCard} onSendReply={onSendReply} />
        </Animated.View>
        {outgoingCard && (
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              opacity: outgoingOpacity,
              transform: [{ translateX: outgoingTranslateX }],
            }}
          >
            <AiCard card={outgoingCard} onSendReply={onSendReply} />
          </Animated.View>
        )}
      </YStack>
    </Reanimated.View>
  )
}

const MemoAnimatedCard = memo(AnimatedCard, (prev, next) => {
  return prev.signature === next.signature && prev.card === next.card
})

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

  const idCounterRef = useRef(0)
  const idByIdentityRef = useRef<Map<string, string>>(new Map())
  const previousSignatureByIdRef = useRef<Map<string, string>>(new Map())
  const pendingGrowthQueueRef = useRef<string[]>([])
  const [activeGrowthCardId, setActiveGrowthCardId] = useState<string | null>(null)

  // ─── Thinking indicator: stays until cards actually update ───
  const awaitingPanelUpdate = useRef(false)
  const thinkingCardsRef = useRef<string>('')

  const cardsSignature = useMemo(() => cards.map(stableCardSignature).join('||'), [cards])

  if (isSending && !awaitingPanelUpdate.current) {
    awaitingPanelUpdate.current = true
  }
  if (awaitingPanelUpdate.current && cardsSignature !== thinkingCardsRef.current && !isSending) {
    awaitingPanelUpdate.current = false
  }
  if (awaitingPanelUpdate.current && !isSending) {
    awaitingPanelUpdate.current = false
  }
  thinkingCardsRef.current = cardsSignature

  const showThinking = isSending || awaitingPanelUpdate.current

  const renderCards = useMemo<RenderCard[]>(() => {
    const identityCounts = new Map<string, number>()
    return cards.map((card) => {
      const base = card.type
      const count = (identityCounts.get(base) ?? 0) + 1
      identityCounts.set(base, count)
      const identity = buildIdentityKey(card.type, count)

      let id = idByIdentityRef.current.get(identity)
      if (!id) {
        idCounterRef.current += 1
        id = `insight-${idCounterRef.current}`
        idByIdentityRef.current.set(identity, id)
      }

      return {
        id,
        identity,
        signature: stableCardSignature(card),
        card,
      }
    })
  }, [cards])

  useEffect(() => {
    const active = new Set(renderCards.map((item) => item.identity))
    for (const identity of idByIdentityRef.current.keys()) {
      if (!active.has(identity)) {
        idByIdentityRef.current.delete(identity)
      }
    }
  }, [renderCards])

  useEffect(() => {
    const prev = previousSignatureByIdRef.current
    const next = new Map<string, string>()
    for (const item of renderCards) {
      next.set(item.id, item.signature)
      const oldSig = prev.get(item.id)
      if (oldSig && oldSig !== item.signature) {
        if (activeGrowthCardId !== item.id && !pendingGrowthQueueRef.current.includes(item.id)) {
          pendingGrowthQueueRef.current.push(item.id)
        }
      }
    }
    previousSignatureByIdRef.current = next

    if (!activeGrowthCardId && pendingGrowthQueueRef.current.length > 0) {
      setActiveGrowthCardId(pendingGrowthQueueRef.current.shift() ?? null)
    }
  }, [activeGrowthCardId, renderCards])

  useEffect(() => {
    if (!activeGrowthCardId) {
      return
    }
    const stillVisible = renderCards.some((item) => item.id === activeGrowthCardId)
    if (!stillVisible) {
      setActiveGrowthCardId(pendingGrowthQueueRef.current.shift() ?? null)
    }
  }, [activeGrowthCardId, renderCards])

  const handleGrowthDone = useCallback((cardId: string) => {
    setActiveGrowthCardId((current) => {
      if (current !== cardId) return current
      return pendingGrowthQueueRef.current.shift() ?? null
    })
  }, [])

  const handleSendReply = useCallback(async (text: string, quotedCard: QuotedCard) => {
    await useChatStore.getState().sendMessage(text, undefined, quotedCard)
  }, [])

  const listLayoutTransition = useMemo(
    () => LinearTransition.springify().damping(22).stiffness(200).mass(0.75),
    []
  )

  if (renderCards.length === 0) {
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
      <Reanimated.View layout={listLayoutTransition}>
        <YStack gap="$3">
          {renderCards.map((item, i) => (
            <MemoAnimatedCard
              key={item.id}
              cardId={item.id}
              card={item.card}
              index={i}
              signature={item.signature}
              isGrowthActive={activeGrowthCardId === item.id}
              onGrowthDone={handleGrowthDone}
              onSendReply={handleSendReply}
            />
          ))}
        </YStack>
      </Reanimated.View>
      <YStack height={24} />
    </YStack>
  )
})
