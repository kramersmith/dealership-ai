import { Animated } from 'react-native'
import { YStack, Text } from 'tamagui'
import type { DealNumbers, DealState, Vehicle } from '@/lib/types'
import { POST_PURCHASE_CHECKLIST } from '@/lib/constants'
import { computeSavings } from '@/lib/dealComputations'
import { useStaggeredFadeIn } from '@/hooks/useAnimatedValue'
import { HeroSection } from './HeroSection'
import { RedFlagsCard } from './RedFlagsCard'
import { KeyNumbers } from './KeyNumbers'
import { InformationGapsCard } from './InformationGapsCard'
import { SavingsSummary } from './SavingsSummary'
import { VehicleCard } from './VehicleCard'
import { NegotiationScorecard } from './NegotiationScorecard'
import { Checklist } from './Checklist'
import { DealershipTimer } from './DealershipTimer'

type AlertWidget = 'timer' | 'red_flags'
type PrimaryWidget = 'savings_summary' | 'key_numbers'
type SecondaryWidget = 'vehicle' | 'scorecard' | 'information_gaps' | 'checklist'

interface PanelLayout {
  alertTier: AlertWidget[]
  primaryTier: PrimaryWidget[]
  secondaryTier: SecondaryWidget[]
}

function getPanelLayout(dealState: DealState, dismissedFlagIds: Set<string>): PanelLayout {
  const hasVehicle = dealState.vehicle !== null
  const hasAnyNumbers = Object.values(dealState.numbers).some((v) => v !== null)
  const hasScorecard = Object.values(dealState.scorecard).some((v) => v !== null)
  const visibleFlags = dealState.redFlags.filter((f) => !dismissedFlagIds.has(f.id))
  const hasGaps = dealState.informationGaps.length > 0
  const isTimerActive = dealState.timerStartedAt !== null
  const isDealComplete = dealState.phase === 'closing'
  const hasSavings =
    dealState.savingsEstimate !== null ||
    computeSavings(dealState.firstOffer, dealState.numbers.currentOffer) !== null
  const hasChecklist = dealState.checklist.length > 0 || isDealComplete

  const alertTier: AlertWidget[] = []
  if (isTimerActive) alertTier.push('timer')
  if (visibleFlags.length > 0) alertTier.push('red_flags')

  const primaryTier: PrimaryWidget[] = []
  if (hasSavings) primaryTier.push('savings_summary')
  if (hasAnyNumbers) primaryTier.push('key_numbers')

  const secondaryTier: SecondaryWidget[] = []
  if (hasVehicle) secondaryTier.push('vehicle')
  if (hasScorecard) secondaryTier.push('scorecard')
  if (hasGaps) secondaryTier.push('information_gaps')
  if (hasChecklist) secondaryTier.push('checklist')

  return {
    alertTier,
    primaryTier,
    secondaryTier,
  }
}

function StaggeredWidget({ index, children }: { index: number; children: React.ReactNode }) {
  const { opacity, translateY } = useStaggeredFadeIn(index)
  return <Animated.View style={{ opacity, transform: [{ translateY }] }}>{children}</Animated.View>
}

interface InsightsPanelProps {
  dealState: DealState
  dismissedFlagIds: Set<string>
  onToggleChecklist: (index: number) => void
  onDismissFlag: (id: string) => void
  onCorrectNumber?: (field: keyof DealNumbers, value: number | null) => void
  onCorrectVehicleField?: (field: keyof Vehicle, value: string | number | undefined) => void
}

export function InsightsPanel({
  dealState,
  dismissedFlagIds,
  onToggleChecklist,
  onDismissFlag,
  onCorrectNumber,
  onCorrectVehicleField,
}: InsightsPanelProps) {
  const layout = getPanelLayout(dealState, dismissedFlagIds)

  const checklist =
    dealState.phase === 'closing' && dealState.checklist.length === 0
      ? POST_PURCHASE_CHECKLIST
      : dealState.checklist

  const alertComponents: Record<AlertWidget, React.ReactNode> = {
    timer: <DealershipTimer startedAt={dealState.timerStartedAt} />,
    red_flags: (
      <RedFlagsCard
        flags={dealState.redFlags}
        dismissedIds={dismissedFlagIds}
        onDismiss={onDismissFlag}
      />
    ),
  }

  const primaryComponents: Record<PrimaryWidget, React.ReactNode> = {
    savings_summary: (
      <SavingsSummary
        firstOffer={dealState.firstOffer}
        currentOffer={dealState.numbers.currentOffer}
        savingsEstimate={dealState.savingsEstimate}
      />
    ),
    key_numbers: (
      <KeyNumbers
        numbers={dealState.numbers}
        phase={dealState.phase}
        preFiPrice={dealState.preFiPrice}
        onCorrectNumber={onCorrectNumber}
      />
    ),
  }

  const secondaryComponents: Record<SecondaryWidget, React.ReactNode> = {
    vehicle: <VehicleCard vehicle={dealState.vehicle} onCorrectField={onCorrectVehicleField} />,
    scorecard: <NegotiationScorecard scorecard={dealState.scorecard} numbers={dealState.numbers} />,
    information_gaps: <InformationGapsCard gaps={dealState.informationGaps} />,
    checklist: <Checklist items={checklist} onToggle={onToggleChecklist} />,
  }

  // Build a flat index for staggered animation across all tiers
  let staggerIndex = 0

  const hasAnyWidgets =
    layout.alertTier.length > 0 || layout.primaryTier.length > 0 || layout.secondaryTier.length > 0

  return (
    <YStack flex={1} paddingHorizontal="$3.5" paddingVertical="$3" gap="$3">
      {/* Hero tier: always visible — phase + recommendation */}
      <StaggeredWidget index={staggerIndex++}>
        <HeroSection dealState={dealState} />
      </StaggeredWidget>

      {/* Empty state: shown when no deal data yet */}
      {!hasAnyWidgets && (
        <StaggeredWidget index={staggerIndex++}>
          <Text
            fontSize={13}
            color="$placeholderColor"
            textAlign="center"
            lineHeight={20}
            paddingVertical="$4"
          >
            As you share deal details, your numbers, vehicle info, and deal assessment will appear
            here.
          </Text>
        </StaggeredWidget>
      )}

      {/* Alert tier: urgent items */}
      {layout.alertTier.length > 0 && (
        <YStack gap="$2">
          {layout.alertTier.map((key) => (
            <StaggeredWidget key={key} index={staggerIndex++}>
              {alertComponents[key]}
            </StaggeredWidget>
          ))}
        </YStack>
      )}

      {/* Primary tier: key data */}
      {layout.primaryTier.length > 0 && (
        <YStack gap="$3.5">
          {layout.primaryTier.map((key) => (
            <StaggeredWidget key={key} index={staggerIndex++}>
              {primaryComponents[key]}
            </StaggeredWidget>
          ))}
        </YStack>
      )}

      {/* Secondary tier: supporting info, more compact */}
      {layout.secondaryTier.length > 0 && (
        <YStack gap="$2.5">
          {layout.secondaryTier.map((key) => (
            <StaggeredWidget key={key} index={staggerIndex++}>
              {secondaryComponents[key]}
            </StaggeredWidget>
          ))}
        </YStack>
      )}
    </YStack>
  )
}
