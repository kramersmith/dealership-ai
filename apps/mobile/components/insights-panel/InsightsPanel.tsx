import { useRef, useEffect, useCallback, useMemo, memo, useState, type ReactNode } from 'react'
import { Animated, Easing, Platform, ScrollView } from 'react-native'
import { YStack, XStack, Text, Button, useTheme } from 'tamagui'
import { BarChart3, Pause, Play, RefreshCw, Sparkles } from '@tamagui/lucide-icons'
import { HeaderIconButton } from '@/components/shared'
import { useFadeIn } from '@/hooks/useAnimatedValue'
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion'
import { api } from '@/lib/api'
import { DISPLAY_FONT_FAMILY } from '@/lib/constants'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { webScrollbarStyle } from '@/lib/scrollbarStyles'
import { palette } from '@/lib/theme/tokens'
import type { AiPanelCard, DealState, QuotedCard, Vehicle } from '@/lib/types'
import { orderedVisibleInsightCards } from '@/lib/insightsPanelCardOrder'
import { useDealStore } from '@/stores/dealStore'
import { useChatStore } from '@/stores/chatStore'
import { useUserSettingsStore } from '@/stores/userSettingsStore'
import { AiCard } from './AiCard'
import { AiVehicleCard } from './AiVehicleCard'
import { SituationBar } from './SituationBar'

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

/**
 * RefreshCw icon that spins continuously while `isSpinning` is true. Used in
 * the InsightsPanel header so the refresh affordance keeps animating until
 * the panel finishes updating. Honors reduced-motion (renders a static icon).
 */
function SpinningRefreshIcon({
  isSpinning,
  prefersReducedMotion,
}: {
  isSpinning: boolean
  prefersReducedMotion: boolean
}) {
  const rotation = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!isSpinning || prefersReducedMotion) {
      rotation.stopAnimation(() => rotation.setValue(0))
      return
    }
    rotation.setValue(0)
    const loop = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: USE_NATIVE_DRIVER,
      })
    )
    loop.start()
    return () => {
      loop.stop()
    }
  }, [isSpinning, prefersReducedMotion, rotation])

  const rotate = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  })

  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <RefreshCw size={16} color={palette.slate300} />
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
        <Sparkles size={18} color="$brand" />
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
  headerAccessory,
}: {
  dealStateOverride?: DealState | null
  headerAccessory?: ReactNode
}) {
  const [isRefreshingAfterInterruption, setIsRefreshingAfterInterruption] = useState(false)
  const storeDealState = useDealStore((state) => state.dealState)
  const dealState = dealStateOverride ?? storeDealState
  const shoppingVehicles = useMemo(
    () => (dealState?.vehicles ?? []).filter((vehicle) => SHOPPING_ROLES.has(vehicle.role)),
    [dealState]
  )
  const cards = useMemo(
    () => orderedVisibleInsightCards(dealState?.aiPanelCards ?? []),
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
  const panelNoticeText =
    panelInterruptionNotice?.reason === 'error'
      ? 'Insights update failed. Refresh to try again.'
      : 'Insights update stopped.'
  const refreshPanel = useCallback(async () => {
    const activeSessionId = useChatStore.getState().activeSessionId
    if (!activeSessionId || useChatStore.getState().isPanelAnalyzing) return
    setIsRefreshingAfterInterruption(true)
    useChatStore.setState({ isPanelAnalyzing: true })
    try {
      const refreshed = await api.refreshInsightsPanel(activeSessionId)
      let dealStateReloaded = false
      try {
        await useDealStore.getState().loadDealState(activeSessionId)
        dealStateReloaded = true
      } catch (error) {
        console.warn(
          '[InsightsPanel] loadDealState after refresh failed:',
          error instanceof Error ? error.message : error
        )
      }
      if (!dealStateReloaded) {
        useDealStore.getState().applyToolCall({
          name: 'update_insights_panel',
          args: {
            cards: refreshed.cards,
            assistantMessageId: refreshed.assistantMessageId,
          },
        })
      }
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
      useChatStore.setState({
        panelInterruptionNotice: {
          reason: 'error',
          at: new Date().toISOString(),
        },
      })
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
  // Inline status badge next to the title — green "Updates after each reply" when
  // live, slate "Paused · Refresh manually" when paused. Shows "Updating now…" /
  // "Saving…" while in transition.
  const statusInline = (() => {
    const tone = isPausedMode
      ? { dot: palette.copilotWarning, text: palette.copilotWarning }
      : { dot: palette.copilotEmerald, text: palette.copilotEmerald200Tint95 }
    const label = isPanelAnalyzing
      ? 'Updating now…'
      : isSettingsUpdating
        ? 'Saving…'
        : isPausedMode
          ? 'Paused · Refresh manually'
          : 'Updates after each reply'
    return (
      <XStack alignItems="center" gap={6} flexShrink={0}>
        <YStack width={6} height={6} borderRadius={999} backgroundColor={tone.dot} />
        <Text fontSize={11} fontWeight="500" color={tone.text} letterSpacing={0.2}>
          {label}
        </Text>
      </XStack>
    )
  })()

  const panelHeaderControls = (
    <XStack alignItems="center" gap={2} flexShrink={0}>
      <HeaderIconButton
        onPress={toggleUpdateMode}
        disabled={isSettingsUpdating}
        accessibilityLabel={
          isPausedMode ? 'Resume live insights updates' : 'Pause live insights updates'
        }
      >
        {isPausedMode ? (
          <Play size={16} color={palette.slate300} />
        ) : (
          <Pause size={16} color={palette.slate300} />
        )}
      </HeaderIconButton>
      <HeaderIconButton
        onPress={refreshPanel}
        disabled={isRefreshingAfterInterruption || isPanelAnalyzing}
        accessibilityLabel={
          isPanelAnalyzing || isRefreshingAfterInterruption
            ? 'Refreshing insights'
            : 'Refresh insights now'
        }
      >
        <SpinningRefreshIcon
          isSpinning={isPanelAnalyzing || isRefreshingAfterInterruption}
          prefersReducedMotion={prefersReducedMotion}
        />
      </HeaderIconButton>
      {headerAccessory ? headerAccessory : null}
    </XStack>
  )

  const panelHeader = (
    <XStack
      alignItems="center"
      justifyContent="space-between"
      gap="$3"
      paddingHorizontal={20}
      // Bottom: the control buttons carry a 44-px hit area (32-px visible
      // chrome inside 6-px transparent margins), so the row already has
      // built-in bottom breathing room — only a few pixels needed to seat the
      // title against the border. Top: extra space so "Your deal at a glance"
      // doesn't sit flush against the panel's top edge.
      paddingTop={20}
      paddingBottom={6}
      borderBottomWidth={1}
      borderBottomColor={palette.ghostBorder}
      backgroundColor="transparent"
    >
      <YStack flex={1} minWidth={0} gap={4}>
        <Text
          fontSize={18}
          fontWeight="500"
          color={palette.slate50}
          lineHeight={22}
          letterSpacing={-0.3}
          fontFamily={DISPLAY_FONT_FAMILY}
          numberOfLines={2}
        >
          Your deal at a glance
        </Text>
        {statusInline}
      </YStack>
      {panelHeaderControls}
    </XStack>
  )

  return (
    <YStack flex={1} backgroundColor="transparent">
      {panelHeader}
      <ScrollView
        showsVerticalScrollIndicator
        style={{ flex: 1, ...webScrollbarStyle } as any}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <YStack
          flexGrow={1}
          paddingHorizontal={INSIGHTS_CONTENT_HORIZONTAL_PADDING_PX}
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
                {panelNoticeText}
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
                        : 'Refresh insights',
                    } as any)
                  : {
                      accessibilityLabel: isRefreshingAfterInterruption
                        ? 'Refreshing insights'
                        : 'Refresh insights',
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
                  ? ({ 'aria-label': 'Dismiss panel notice' } as any)
                  : { accessibilityLabel: 'Dismiss panel notice' })}
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
    </YStack>
  )
})
