import { useRef, useEffect, useCallback, useMemo, memo, useState } from 'react'
import { Animated, Easing, Platform, ScrollView } from 'react-native'
import { YStack, XStack, Text, Button, useTheme } from 'tamagui'
import { BarChart3, RefreshCw, Sparkles } from '@tamagui/lucide-icons'
import { useFadeIn } from '@/hooks/useAnimatedValue'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { api } from '@/lib/api'
import { PANEL_FOOTER_MIN_HEIGHT, WEB_SCROLLBAR_GUTTER_PX } from '@/lib/constants'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { palette } from '@/lib/theme/tokens'
import type { AiPanelCard, DealState, QuotedCard, Vehicle } from '@/lib/types'
import { useDealStore } from '@/stores/dealStore'
import { useChatStore } from '@/stores/chatStore'
import { useUserSettingsStore } from '@/stores/userSettingsStore'
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
const INSIGHTS_CONTENT_HORIZONTAL_PADDING_PX = 16

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
  const [isRefreshingAfterInterruption, setIsRefreshingAfterInterruption] = useState(false)
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
  const isPanelAnalyzing = useChatStore((state) => state.isPanelAnalyzing)
  const panelInterruptionNotice = useChatStore((state) => state.panelInterruptionNotice)
  const insightsPanelCommitGeneration = useChatStore((state) => state.insightsPanelCommitGeneration)
  const insightsUpdateMode = useUserSettingsStore((state) => state.insightsUpdateMode)
  const updateUserSettings = useUserSettingsStore((state) => state.updateSettings)
  const isSettingsUpdating = useUserSettingsStore((state) => state.isLoading)
  const prefersReducedMotion = usePrefersReducedMotion()
  const theme = useTheme()
  const panelContentPaddingRight =
    Platform.OS === 'web'
      ? Math.max(0, INSIGHTS_CONTENT_HORIZONTAL_PADDING_PX - WEB_SCROLLBAR_GUTTER_PX)
      : INSIGHTS_CONTENT_HORIZONTAL_PADDING_PX

  const panelOpacity = useRef(new Animated.Value(1)).current
  const panelTranslateY = useRef(new Animated.Value(0)).current
  const prevCommitGenRef = useRef(0)
  const prevCardsSnapshotRef = useRef(cards)

  const isPausedMode = insightsUpdateMode === 'paused'
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
  const dismissPanelInterruptionNotice = useCallback(
    () => useChatStore.setState({ panelInterruptionNotice: null }),
    []
  )
  const refreshPanel = useCallback(async () => {
    const activeSessionId = useChatStore.getState().activeSessionId
    if (!activeSessionId) return
    setIsRefreshingAfterInterruption(true)
    useChatStore.setState({ isPanelAnalyzing: true })
    try {
      const refreshed = await api.refreshInsightsPanel(activeSessionId)
      useDealStore.getState().applyToolCall({
        name: 'update_insights_panel',
        args: {
          cards: refreshed.cards,
          assistantMessageId: refreshed.assistantMessageId,
        },
      })
      useChatStore.setState((state) => ({
        panelInterruptionNotice: null,
        messages: state.messages.map((message) =>
          message.id === refreshed.assistantMessageId
            ? { ...message, panelCards: refreshed.cards }
            : message
        ),
      }))
    } catch (error) {
      console.warn(
        '[InsightsPanel] refreshInsightsPanel failed:',
        error instanceof Error ? error.message : error
      )
    } finally {
      setIsRefreshingAfterInterruption(false)
      useChatStore.setState({ isPanelAnalyzing: false })
    }
  }, [])
  const setUpdateMode = useCallback(
    (nextMode: 'live' | 'paused') => {
      if (nextMode === insightsUpdateMode) return
      void updateUserSettings({ insightsUpdateMode: nextMode }).catch((error) => {
        console.warn(
          '[InsightsPanel] Failed to update insights update mode:',
          error instanceof Error ? error.message : error
        )
      })
    },
    [insightsUpdateMode, updateUserSettings]
  )
  const toggleUpdateMode = useCallback(() => {
    setUpdateMode(isPausedMode ? 'live' : 'paused')
  }, [isPausedMode, setUpdateMode])
  const updatesExplainer = isSettingsUpdating
    ? 'Saving...'
    : isPausedMode
      ? 'Refresh when you want a new read.'
      : 'Updates after each reply.'
  const panelControlsFooter = (
    <XStack
      alignItems="flex-start"
      justifyContent="space-between"
      gap="$3"
      minHeight={PANEL_FOOTER_MIN_HEIGHT}
      paddingHorizontal="$3"
      paddingVertical="$2"
      borderTopWidth={1}
      borderTopColor="$borderColor"
      backgroundColor="$backgroundStrong"
    >
      <YStack flex={1} minWidth={0} gap="$0.75">
        {isPanelAnalyzing ? (
          <XStack alignItems="center" gap="$2">
            <ThinkingIndicator />
          </XStack>
        ) : null}
        <Text fontSize={11} color="$placeholderColor" lineHeight={15} flexShrink={1}>
          {updatesExplainer}
        </Text>
      </YStack>
      <XStack alignItems="center" gap="$2" flexShrink={0}>
        <Button
          size="$3"
          minHeight={44}
          minWidth={92}
          paddingHorizontal="$3.5"
          borderRadius="$5"
          borderWidth={1}
          borderColor={isPausedMode ? '$borderColor' : 'transparent'}
          backgroundColor={isPausedMode ? '$backgroundStrong' : '$brand'}
          onPress={toggleUpdateMode}
          disabled={isSettingsUpdating}
          hoverStyle={{
            backgroundColor: isPausedMode ? '$backgroundHover' : '$brand',
            borderColor: isPausedMode ? '$borderColor' : 'transparent',
          }}
          pressStyle={{ opacity: 0.9 }}
          {...(Platform.OS === 'web'
            ? ({
                'aria-label': isPausedMode
                  ? 'Resume live insights updates'
                  : 'Pause live insights updates',
              } as any)
            : {
                accessibilityLabel: isPausedMode
                  ? 'Resume live insights updates'
                  : 'Pause live insights updates',
              })}
        >
          <Button.Text fontSize={11} color={isPausedMode ? '$color' : '$white'} fontWeight="700">
            {isPausedMode ? 'Paused' : 'Live'}
          </Button.Text>
        </Button>
        <Button
          size="$3"
          width={44}
          minWidth={44}
          minHeight={44}
          paddingHorizontal="$0"
          borderRadius="$5"
          backgroundColor="$brand"
          onPress={refreshPanel}
          disabled={isRefreshingAfterInterruption}
          pressStyle={{ opacity: 0.85 }}
          {...(Platform.OS === 'web'
            ? ({ 'aria-label': 'Refresh insights now' } as any)
            : { accessibilityLabel: 'Refresh insights now' })}
        >
          <RefreshCw size={16} color="$white" />
        </Button>
      </XStack>
    </XStack>
  )

  return (
    <YStack flex={1} backgroundColor="$backgroundStrong">
      <ScrollView
        showsVerticalScrollIndicator
        style={
          Platform.OS === 'web'
            ? ({
                flex: 1,
                scrollbarWidth: 'thin',
                scrollbarColor: `${theme.placeholderColor?.val ?? palette.overlay} transparent`,
              } as any)
            : { flex: 1 }
        }
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <YStack
          flexGrow={1}
          paddingLeft={INSIGHTS_CONTENT_HORIZONTAL_PADDING_PX}
          paddingRight={panelContentPaddingRight}
          paddingTop="$4"
          paddingBottom="$6"
          gap="$3"
        >
          <PanelUpdatingBanner
            visible={isPanelAnalyzing}
            prefersReducedMotion={prefersReducedMotion}
          />
          {panelInterruptionNotice ? (
            <XStack
              alignItems="center"
              gap="$2"
              paddingVertical="$2"
              paddingHorizontal="$3"
              borderRadius={10}
              borderWidth={1}
              borderColor="$borderColor"
              backgroundColor="$backgroundHover"
            >
              <Text fontSize={12} color="$placeholderColor" flex={1}>
                Insights update stopped.
              </Text>
              <Button
                size="$3"
                minHeight={44}
                paddingHorizontal="$3"
                borderRadius="$3"
                onPress={refreshPanel}
                disabled={isRefreshingAfterInterruption}
                pressStyle={{ opacity: 0.85 }}
                {...(Platform.OS === 'web'
                  ? ({
                      'aria-label': isRefreshingAfterInterruption
                        ? 'Refreshing insights'
                        : 'Refresh insights after interruption',
                    } as any)
                  : {
                      accessibilityLabel: isRefreshingAfterInterruption
                        ? 'Refreshing insights'
                        : 'Refresh insights after interruption',
                    })}
              >
                <Button.Text fontSize={11}>
                  {isRefreshingAfterInterruption ? 'Refreshing...' : 'Refresh insights'}
                </Button.Text>
              </Button>
              <Button
                size="$3"
                minHeight={44}
                paddingHorizontal="$3"
                borderRadius="$3"
                onPress={dismissPanelInterruptionNotice}
                pressStyle={{ opacity: 0.85 }}
                {...(Platform.OS === 'web'
                  ? ({ 'aria-label': 'Dismiss interruption notice' } as any)
                  : { accessibilityLabel: 'Dismiss interruption notice' })}
              >
                <Button.Text fontSize={11}>Dismiss</Button.Text>
              </Button>
            </XStack>
          ) : null}
          {hasSituationBar ? <SituationBar context={negotiationContext!} /> : null}
          {cards.length === 0 && !hasSituationBar ? (
            <YStack flex={1} minHeight={280}>
              <EmptyState thinking={isPanelAnalyzing} />
            </YStack>
          ) : (
            <>
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
            </>
          )}
        </YStack>
      </ScrollView>
      {panelControlsFooter}
    </YStack>
  )
})
