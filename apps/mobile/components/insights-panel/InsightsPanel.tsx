import { useRef, useEffect, useCallback, useMemo, memo } from 'react'
import { Animated, Easing } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { BarChart3, Sparkles } from '@tamagui/lucide-icons'
import { useFadeIn } from '@/hooks/useAnimatedValue'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import type { AiPanelCard, DealState, QuotedCard, Vehicle } from '@/lib/types'
import { useDealStore } from '@/stores/dealStore'
import { useChatStore } from '@/stores/chatStore'
import { AiCard } from './AiCard'
import { AiVehicleCard } from './AiVehicleCard'
import { SituationBar } from './SituationBar'
import { ThinkingIndicator } from './ThinkingIndicator'

// ─── Panel refresh: subtle settle (opacity + tiny vertical) — no horizontal strip ───
// UX: dense side panels favor a light “content refreshed” cue over carousel motion (readable, robust).

const PANEL_REFRESH_MS = 280
const PANEL_ENTER_FROM_OPACITY = 0.88
const PANEL_ENTER_FROM_Y = 6
const PANEL_REFRESH_EASING = Easing.bezier(0.33, 1, 0.68, 1)
const PANEL_ANALYZING_PULSE_MS = 900
const PANEL_ANALYZING_MIN_OPACITY = 0.6

function stableCardSignature(card: AiPanelCard): string {
  return `${card.kind}|${card.template}|${card.title}|${card.priority}|${JSON.stringify(card.content ?? {})}`
}

const SHOPPING_ROLES = new Set<Vehicle['role']>(['primary', 'candidate'])

function orderedInsightCards(aiPanelCards: AiPanelCard[]): AiPanelCard[] {
  const visibleCards = aiPanelCards.filter(
    (card) => card.kind !== 'comparison' && card.kind !== 'trade_off'
  )
  const phaseCards = visibleCards.filter((card) => card.kind === 'phase')
  const nonPhaseCards = visibleCards.filter((card) => card.kind !== 'phase')
  return [...phaseCards, ...nonPhaseCards]
}

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

// ─── Panel Header (hero — primary product surface) ───

function PanelHeader({ thinking }: { thinking: boolean }) {
  return (
    <XStack alignItems="stretch" gap="$3" paddingBottom="$2">
      <YStack width={3} borderRadius={2} backgroundColor="$brand" opacity={0.95} />
      <YStack flex={1} gap="$1.5">
        <XStack alignItems="center" gap="$2" flexWrap="wrap">
          <BarChart3 size={18} color="$brand" strokeWidth={2.25} />
          <Text fontSize={15} fontWeight="700" color="$color" letterSpacing={-0.2}>
            Insights
          </Text>
          {thinking && <ThinkingIndicator />}
        </XStack>
        <Text fontSize={12} color="$placeholderColor" lineHeight={16} opacity={0.95}>
          Live deal intelligence — numbers, risks, and next steps in one place.
        </Text>
      </YStack>
    </XStack>
  )
}

// ─── Empty State ───

function EmptyState({ thinking }: { thinking: boolean }) {
  const opacity = useFadeIn(500)
  return (
    <Animated.View style={{ flex: 1, opacity }}>
      <YStack
        flex={1}
        alignItems="center"
        justifyContent="center"
        gap="$4"
        padding="$4"
        paddingTop="$2"
      >
        <YStack
          width={72}
          height={72}
          borderRadius={36}
          alignItems="center"
          justifyContent="center"
          backgroundColor="$brandSubtle"
          borderWidth={1}
          borderColor="$borderColor"
        >
          {thinking ? (
            <BarChart3 size={30} color="$brand" opacity={0.9} strokeWidth={2} />
          ) : (
            <Sparkles size={28} color="$brand" opacity={0.85} strokeWidth={2} />
          )}
        </YStack>
        <YStack gap="$2" alignItems="center" maxWidth={280}>
          <Text
            fontSize={17}
            fontWeight="700"
            color="$color"
            textAlign="center"
            letterSpacing={-0.3}
          >
            {thinking ? 'Building your insights' : 'Your deal intelligence hub'}
          </Text>
          <Text fontSize={14} color="$placeholderColor" textAlign="center" lineHeight={22}>
            {thinking
              ? 'We’re turning this reply into cards you can scan at a glance — hang tight.'
              : 'As you chat, we’ll surface pricing, red flags, and negotiation context here — not buried in the thread.'}
          </Text>
        </YStack>
      </YStack>
    </Animated.View>
  )
}

function PanelUpdatingBanner({
  visible,
  prefersReducedMotion,
}: {
  visible: boolean
  prefersReducedMotion: boolean
}) {
  const pulseOpacity = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (!visible || prefersReducedMotion) {
      // Reduced motion: render a steady (non-pulsing) banner. A continuously
      // pulsing element is a textbook reduced-motion violation.
      pulseOpacity.setValue(1)
      return
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseOpacity, {
          toValue: PANEL_ANALYZING_MIN_OPACITY,
          duration: PANEL_ANALYZING_PULSE_MS / 2,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(pulseOpacity, {
          toValue: 1,
          duration: PANEL_ANALYZING_PULSE_MS / 2,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ])
    )
    loop.start()

    return () => {
      loop.stop()
      pulseOpacity.setValue(1)
    }
  }, [visible, prefersReducedMotion, pulseOpacity])

  if (!visible) return null

  return (
    <Animated.View style={{ opacity: pulseOpacity }}>
      <XStack
        alignItems="center"
        gap="$2"
        paddingVertical="$2"
        paddingHorizontal="$3"
        borderRadius={10}
        borderWidth={1}
        borderColor="$borderColor"
        backgroundColor="$brandSubtle"
      >
        <Sparkles size={14} color="$brand" />
        <Text fontSize={12} fontWeight="600" color="$brand" flex={1}>
          Updating insights from your latest message...
        </Text>
      </XStack>
    </Animated.View>
  )
}

const MemoAiCard = memo(AiCard)

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
  const cards = useMemo(
    () => orderedInsightCards(dealState?.aiPanelCards ?? []),
    [dealState?.aiPanelCards]
  )
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
  const insightsPanelCommitGeneration = useChatStore((state) => state.insightsPanelCommitGeneration)
  const prefersReducedMotion = usePrefersReducedMotion()

  const panelOpacity = useRef(new Animated.Value(1)).current
  const panelTranslateY = useRef(new Animated.Value(0)).current
  const prevCommitGenRef = useRef(0)
  const prevCardsSnapshotRef = useRef(cards)

  const showThinking = isSending || isPanelAnalyzing
  const negotiationContext = dealState?.negotiationContext ?? null
  const hasPhaseCard = useMemo(() => cards.some((card) => card.kind === 'phase'), [cards])
  const hasSituationBar =
    Boolean(negotiationContext?.situation && negotiationContext?.stance) && !hasPhaseCard

  useEffect(() => {
    const gen = insightsPanelCommitGeneration
    const priorGen = prevCommitGenRef.current
    const priorCards = prevCardsSnapshotRef.current

    if (gen === 0 || prefersReducedMotion) {
      panelOpacity.setValue(1)
      panelTranslateY.setValue(0)
      prevCommitGenRef.current = gen
      prevCardsSnapshotRef.current = cards
      return
    }
    if (gen < priorGen) {
      panelOpacity.setValue(1)
      panelTranslateY.setValue(0)
      prevCommitGenRef.current = gen
      prevCardsSnapshotRef.current = cards
      return
    }

    const sameSnapshot =
      priorCards.length === cards.length &&
      priorCards.every((c, i) => stableCardSignature(c) === stableCardSignature(cards[i]!))

    if (sameSnapshot) {
      panelOpacity.setValue(1)
      panelTranslateY.setValue(0)
      prevCommitGenRef.current = gen
      prevCardsSnapshotRef.current = cards
      return
    }

    prevCommitGenRef.current = gen
    prevCardsSnapshotRef.current = cards

    panelOpacity.setValue(PANEL_ENTER_FROM_OPACITY)
    panelTranslateY.setValue(PANEL_ENTER_FROM_Y)

    Animated.parallel([
      Animated.timing(panelOpacity, {
        toValue: 1,
        duration: PANEL_REFRESH_MS,
        easing: PANEL_REFRESH_EASING,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(panelTranslateY, {
        toValue: 0,
        duration: PANEL_REFRESH_MS,
        easing: PANEL_REFRESH_EASING,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]).start()
  }, [insightsPanelCommitGeneration, cards, prefersReducedMotion, panelOpacity, panelTranslateY])

  const handleSendReply = useCallback(async (text: string, quotedCard: QuotedCard) => {
    await useChatStore
      .getState()
      .sendMessage(text, undefined, quotedCard, false, undefined, 'card_reply')
  }, [])

  if (cards.length === 0 && !hasSituationBar) {
    return (
      <YStack flex={1} paddingHorizontal="$4" paddingVertical="$4">
        <PanelHeader thinking={showThinking} />
        <EmptyState thinking={showThinking} />
      </YStack>
    )
  }

  return (
    <YStack flex={1} paddingHorizontal="$4" paddingTop="$4" gap="$3">
      <PanelHeader thinking={showThinking} />
      <PanelUpdatingBanner visible={showThinking} prefersReducedMotion={prefersReducedMotion} />
      {hasSituationBar ? <SituationBar context={negotiationContext!} /> : null}
      <Animated.View
        style={{
          opacity: panelOpacity,
          transform: [{ translateY: panelTranslateY }],
        }}
      >
        <YStack gap="$3.5">
          {cards.map((card, i) => (
            <MemoAiCard
              key={`${i}-${card.kind}-${stableCardSignature(card)}`}
              card={card}
              onSendReply={handleSendReply}
            />
          ))}
        </YStack>
      </Animated.View>
      {parkedVehicles.length > 0 ? (
        <YStack gap="$3" marginTop="$1">
          <XStack alignItems="center" gap="$2">
            <YStack flex={1} height={1} backgroundColor="$borderColor" opacity={0.75} />
            <Text
              fontSize={10}
              fontWeight="700"
              color="$placeholderColor"
              textTransform="uppercase"
              letterSpacing={1}
            >
              Archived
            </Text>
            <YStack flex={1} height={1} backgroundColor="$borderColor" opacity={0.75} />
          </XStack>
          <Text fontSize={12} color="$placeholderColor" lineHeight={18} opacity={0.9}>
            Vehicles you’re no longer tracking in the live stack
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
