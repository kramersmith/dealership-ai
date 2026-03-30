import { useRef, useEffect, useCallback, memo } from 'react'
import { Animated } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { BarChart3 } from '@tamagui/lucide-icons'
import type { AiPanelCard, DealState } from '@/lib/types'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { useDealStore } from '@/stores/dealStore'
import { AiCard } from './AiCard'

/** Animate a card sliding in. Only animates on first mount. */
const AnimatedCard = memo(function AnimatedCard({
  index,
  card,
  dealState,
  skipAnimation,
  onCorrectNumber,
  onCorrectVehicleField,
  onToggleChecklist,
}: {
  index: number
  card: AiPanelCard
  dealState: DealState
  skipAnimation: boolean
  onCorrectNumber?: (dealId: string, field: string, value: number | null) => void
  onCorrectVehicleField?: (
    vehicleId: string,
    field: string,
    value: string | number | undefined
  ) => void
  onToggleChecklist?: (index: number) => void
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
      <AiCard
        card={card}
        dealState={dealState}
        onCorrectNumber={onCorrectNumber}
        onCorrectVehicleField={onCorrectVehicleField}
        onToggleChecklist={onToggleChecklist}
      />
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
  const correctNumber = useDealStore((s) => s.correctNumber)
  const correctVehicleField = useDealStore((s) => s.correctVehicleField)
  const toggleChecklistItem = useDealStore((s) => s.toggleChecklistItem)
  const cards = dealState?.aiPanelCards ?? []
  const hasAnimatedOnce = useRef(false)

  // Only animate the first time cards appear — subsequent updates render immediately
  const skipAnimation = hasAnimatedOnce.current
  if (cards.length > 0 && !hasAnimatedOnce.current) {
    hasAnimatedOnce.current = true
  }

  // Stable callbacks for inline editing
  const handleCorrectNumber = useCallback(
    (dealId: string, field: string, value: number | null) => {
      correctNumber(dealId, field as any, value)
    },
    [correctNumber]
  )

  const handleCorrectVehicleField = useCallback(
    (vehicleId: string, field: string, value: string | number | undefined) => {
      correctVehicleField(vehicleId, field as any, value)
    },
    [correctVehicleField]
  )

  const handleToggleChecklist = useCallback(
    (index: number) => {
      toggleChecklistItem(index)
    },
    [toggleChecklistItem]
  )

  if (cards.length === 0) {
    return (
      <YStack flex={1} paddingHorizontal="$3.5" paddingVertical="$3">
        <PanelHeader />
        <EmptyState />
      </YStack>
    )
  }

  return (
    <YStack flex={1} paddingHorizontal="$3.5" paddingVertical="$3" gap="$3">
      <PanelHeader />
      {cards.map((card, i) => (
        <AnimatedCard
          key={`panel-card-${i}`}
          index={i}
          card={card}
          dealState={dealState!}
          skipAnimation={skipAnimation}
          onCorrectNumber={handleCorrectNumber}
          onCorrectVehicleField={handleCorrectVehicleField}
          onToggleChecklist={handleToggleChecklist}
        />
      ))}
    </YStack>
  )
})
