import { useRef, useEffect, useCallback, useMemo, memo, useState } from 'react'
import { Animated, Easing } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { BarChart3 } from '@tamagui/lucide-icons'
import Reanimated, { FadeInLeft, LinearTransition, SlideOutRight } from 'react-native-reanimated'
import { useFadeIn } from '@/hooks/useAnimatedValue'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import type { AiPanelCard, DealState, QuotedCard, Vehicle } from '@/lib/types'
import { useDealStore } from '@/stores/dealStore'
import { useChatStore } from '@/stores/chatStore'
import { AiCard } from './AiCard'
import { AiVehicleCard } from './AiVehicleCard'
import { SituationBar } from './SituationBar'
import { ThinkingIndicator } from './ThinkingIndicator'

// ─── Timing ───

const ENTRANCE_DURATION = 200
const ENTRANCE_STAGGER = 22
const EXIT_DURATION = 170
const UPDATE_FADE_OUT_MS = 90
const UPDATE_FADE_IN_MS = 140

function stableCardSignature(card: AiPanelCard): string {
  return `${card.kind}|${card.template}|${card.title}|${card.priority}|${JSON.stringify(card.content ?? {})}`
}

function buildIdentityKey(cardKind: AiPanelCard['kind'], occurrence: number): string {
  // Identity should ignore mutable card content/title so replacements animate in-place.
  return `${cardKind}#${occurrence}`
}

interface RenderCard {
  id: string
  identity: string
  signature: string
  card: AiPanelCard
}

const SHOPPING_ROLES = new Set<Vehicle['role']>(['primary', 'candidate'])

/** Aligns with backend `panel_cards._panel_card_dedupe_identity` for vehicle cards (VIN else role+YMM+mileage+color). */
function shoppingVehiclePanelFingerprint(vehicle: Vehicle): string {
  const vin = vehicle.vin?.trim()
  if (vin) return `vin:${vin}`
  const role = vehicle.role ?? ''
  const year = vehicle.year ?? ''
  const make = vehicle.make ?? ''
  const model = vehicle.model ?? ''
  const mileage = vehicle.mileage != null ? String(vehicle.mileage) : ''
  const color = vehicle.color ?? ''
  return `spec:${role}:${year}:${make}:${model}:${mileage}:${color}`
}

function panelCardVehicleFingerprint(content: Record<string, unknown> | undefined): string | null {
  const raw = content?.vehicle
  if (!raw || typeof raw !== 'object') return null
  const vehicleData = raw as Record<string, unknown>
  const vin =
    typeof vehicleData.vin === 'string' && vehicleData.vin.trim() ? vehicleData.vin.trim() : ''
  if (vin) return `vin:${vin}`
  const role = typeof vehicleData.role === 'string' ? vehicleData.role : ''
  const year = typeof vehicleData.year === 'number' ? vehicleData.year : ''
  const make = typeof vehicleData.make === 'string' ? vehicleData.make : ''
  const model = typeof vehicleData.model === 'string' ? vehicleData.model : ''
  const mileage = typeof vehicleData.mileage === 'number' ? String(vehicleData.mileage) : ''
  const color = typeof vehicleData.color === 'string' ? vehicleData.color : ''
  if (!make && !model && year === '') return null
  return `spec:${role}:${year}:${make}:${model}:${mileage}:${color}`
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

function EmptyState({ thinking }: { thinking: boolean }) {
  const opacity = useFadeIn(500)
  return (
    <Animated.View style={{ flex: 1, opacity }}>
      <YStack flex={1} alignItems="center" justifyContent="center" gap="$3" padding="$4">
        <BarChart3 size={28} color="$placeholderColor" opacity={0.5} />
        <YStack gap="$1.5" alignItems="center">
          <Text fontSize={14} fontWeight="600" color="$color" textAlign="center">
            {thinking ? 'Analyzing your deal' : 'No insights yet'}
          </Text>
          <Text fontSize={13} color="$placeholderColor" textAlign="center" lineHeight={20}>
            {thinking
              ? 'Your advisor is turning this turn into updated panel cards now.'
              : 'Share details about your deal and your AI advisor will surface key insights here.'}
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

    if (isGrowthActive) {
      pendingRef.current = { card, signature }
      const pending = pendingRef.current
      if (pending) {
        pendingRef.current = null
        runGrowthTransition(pending.card, pending.signature)
      }
      return
    }

    // Signature changed but growth is not active for this slot yet — still sync
    // so phase and warning cards never show mismatched-era copy.
    setVisibleCard(card)
    visibleCardRef.current = card
    displayedSignatureRef.current = signature
    pendingRef.current = null
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
  const storeDealState = useDealStore((state) => state.dealState)
  const dealState = dealStateOverride ?? storeDealState
  const shoppingVehicles = useMemo(
    () => (dealState?.vehicles ?? []).filter((vehicle) => SHOPPING_ROLES.has(vehicle.role)),
    [dealState]
  )
  const cards = useMemo(() => {
    const visibleCards = (dealState?.aiPanelCards ?? []).filter(
      (card) => card.kind !== 'comparison' && card.kind !== 'trade_off'
    )
    const phaseCards = visibleCards.filter((card) => card.kind === 'phase')
    const nonPhaseCards = visibleCards.filter((card) => card.kind !== 'phase')
    return [...phaseCards, ...nonPhaseCards]
  }, [dealState])
  const panelVehicleFingerprints = useMemo(() => {
    const fingerprints = new Set<string>()
    for (const card of cards) {
      if (card.kind !== 'vehicle') continue
      const fingerprint = panelCardVehicleFingerprint(card.content as Record<string, unknown>)
      if (fingerprint) fingerprints.add(fingerprint)
    }
    return fingerprints
  }, [cards])
  const parkedVehicles = useMemo(() => {
    // Every shopping vehicle except the active deal's truck, minus any already shown
    // as a vehicle card (supports multiple candidates — only "missing" ones park here).
    if (shoppingVehicles.length <= 1) {
      return [] as Vehicle[]
    }
    const activeId = dealState?.activeDealId ?? null
    if (!activeId) {
      return [] as Vehicle[]
    }
    const activeDeal = dealState?.deals?.find((deal) => deal.id === activeId)
    if (!activeDeal) {
      return [] as Vehicle[]
    }
    const focusedVehicleId = activeDeal.vehicleId
    return shoppingVehicles.filter((vehicle) => {
      if (vehicle.id === focusedVehicleId) return false
      const fingerprint = shoppingVehiclePanelFingerprint(vehicle)
      if (panelVehicleFingerprints.has(fingerprint)) return false
      return true
    })
  }, [shoppingVehicles, dealState?.activeDealId, dealState?.deals, panelVehicleFingerprints])
  const isSending = useChatStore((state) => state.isSending)
  const isPanelAnalyzing = useChatStore((state) => state.isPanelAnalyzing)

  const idCounterRef = useRef(0)
  const idByIdentityRef = useRef<Map<string, string>>(new Map())
  const previousSignatureByIdRef = useRef<Map<string, string>>(new Map())
  const pendingGrowthQueueRef = useRef<string[]>([])
  const [activeGrowthCardId, setActiveGrowthCardId] = useState<string | null>(null)

  const showThinking = isSending || isPanelAnalyzing
  const negotiationContext = dealState?.negotiationContext ?? null
  const hasPhaseCard = useMemo(() => cards.some((card) => card.kind === 'phase'), [cards])
  const hasSituationBar =
    Boolean(negotiationContext?.situation && negotiationContext?.stance) && !hasPhaseCard
  const renderCards = useMemo<RenderCard[]>(() => {
    const identityCounts = new Map<string, number>()
    return cards.map((card) => {
      const base = card.kind
      const count = (identityCounts.get(base) ?? 0) + 1
      identityCounts.set(base, count)
      const identity = buildIdentityKey(card.kind, count)

      let renderCardId = idByIdentityRef.current.get(identity)
      if (!renderCardId) {
        idCounterRef.current += 1
        renderCardId = `insight-${idCounterRef.current}`
        idByIdentityRef.current.set(identity, renderCardId)
      }

      return {
        id: renderCardId,
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

  if (renderCards.length === 0 && !hasSituationBar) {
    return (
      <YStack flex={1} paddingHorizontal="$3.5" paddingVertical="$3">
        <PanelHeader thinking={showThinking} />
        <EmptyState thinking={showThinking} />
      </YStack>
    )
  }

  return (
    <YStack flex={1} paddingHorizontal="$3.5" paddingTop="$3" gap="$3">
      <PanelHeader thinking={showThinking} />
      {hasSituationBar ? <SituationBar context={negotiationContext!} /> : null}
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
      {parkedVehicles.length > 0 ? (
        <YStack gap="$2">
          <YStack
            height={1}
            backgroundColor="$borderColor"
            opacity={0.8}
            marginTop="$1"
            marginBottom="$2"
          />
          <Text
            fontSize={12}
            fontWeight="600"
            color="$placeholderColor"
            textTransform="uppercase"
            letterSpacing={0.5}
          >
            No longer receiving updates
          </Text>
          {parkedVehicles.map((vehicle) => {
            const headline = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
              .filter(Boolean)
              .join(' ')
            return (
              <AiVehicleCard
                key={`parked-${vehicle.id}`}
                title="Vehicle"
                collapsedByDefault
                content={{
                  vehicle: {
                    vin: vehicle.vin,
                    year: vehicle.year,
                    make: vehicle.make,
                    model: vehicle.model,
                    trim: vehicle.trim,
                    headline: headline || undefined,
                    specs: {
                      engine: vehicle.engine,
                      cab: vehicle.cabStyle,
                      mileage: vehicle.mileage,
                      color: vehicle.color,
                      bed_length: vehicle.bedLength,
                    },
                  },
                }}
              />
            )
          })}
        </YStack>
      ) : null}
      <YStack height={24} />
    </YStack>
  )
})
