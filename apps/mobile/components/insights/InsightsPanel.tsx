import { YStack } from 'tamagui'
import type { DealNumbers, DealState, Vehicle } from '@/lib/types'
import { POST_PURCHASE_CHECKLIST } from '@/lib/constants'
import { computeSavings } from '@/lib/dealComputations'
import { DealPhaseIndicator } from './DealPhaseIndicator'
import { DealHealthCard } from './DealHealthCard'
import { RedFlagsCard } from './RedFlagsCard'
import { KeyNumbers } from './KeyNumbers'
import { InformationGapsCard } from './InformationGapsCard'
import { SavingsSummary } from './SavingsSummary'
import { VehicleCard } from './VehicleCard'
import { NegotiationScorecard } from './NegotiationScorecard'
import { Checklist } from './Checklist'
import { DealershipTimer } from './DealershipTimer'

type PanelWidget =
  | 'timer'
  | 'savings_summary'
  | 'deal_health'
  | 'red_flags'
  | 'key_numbers'
  | 'information_gaps'
  | 'vehicle'
  | 'scorecard'
  | 'checklist'

function getPanelWidgets(dealState: DealState, dismissedFlagIds: Set<string>): PanelWidget[] {
  const hasVehicle = dealState.vehicle !== null
  const hasOffer = dealState.numbers.currentOffer !== null
  const hasAnyNumbers = Object.values(dealState.numbers).some((v) => v !== null)
  const hasScorecard = Object.values(dealState.scorecard).some((v) => v !== null)
  const visibleFlags = dealState.redFlags.filter((f) => !dismissedFlagIds.has(f.id))
  const hasGaps = dealState.informationGaps.length > 0
  const isTimerActive = dealState.timerStartedAt !== null
  const hasTarget = dealState.numbers.yourTarget !== null
  const isDealComplete = dealState.phase === 'closing'
  const hasSavings =
    dealState.savingsEstimate !== null ||
    computeSavings(dealState.firstOffer, dealState.numbers.currentOffer) !== null
  const hasChecklist = dealState.checklist.length > 0 || isDealComplete

  const widgets: PanelWidget[] = []

  if (isTimerActive) widgets.push('timer')
  if (isDealComplete && hasSavings) widgets.push('savings_summary')
  if (hasOffer && hasTarget) widgets.push('deal_health')
  if (visibleFlags.length > 0) widgets.push('red_flags')
  if (hasAnyNumbers) widgets.push('key_numbers')
  if (hasGaps) widgets.push('information_gaps')
  if (hasVehicle) widgets.push('vehicle')
  if (hasScorecard) widgets.push('scorecard')
  if (hasChecklist) widgets.push('checklist')

  return widgets
}

interface InsightsPanelProps {
  dealState: DealState
  dismissedFlagIds: Set<string>
  onToggleChecklist: (index: number) => void
  onDismissFlag: (id: string) => void
  onCorrectNumber?: (field: keyof DealNumbers, value: number | null) => void
  onCorrectVehicleField?: (field: keyof Vehicle, value: string | number | undefined) => void
  mode?: 'mobile' | 'sidebar'
}

export function InsightsPanel({
  dealState,
  dismissedFlagIds,
  onToggleChecklist,
  onDismissFlag,
  onCorrectNumber,
  onCorrectVehicleField,
  mode = 'mobile',
}: InsightsPanelProps) {
  const isSidebar = mode === 'sidebar'
  const widgets = getPanelWidgets(dealState, dismissedFlagIds)

  const checklist =
    dealState.phase === 'closing' && dealState.checklist.length === 0
      ? POST_PURCHASE_CHECKLIST
      : dealState.checklist

  const widgetComponents: Record<PanelWidget, React.ReactNode | null> = {
    timer: <DealershipTimer startedAt={dealState.timerStartedAt} />,
    savings_summary: (
      <SavingsSummary
        firstOffer={dealState.firstOffer}
        currentOffer={dealState.numbers.currentOffer}
        savingsEstimate={dealState.savingsEstimate}
      />
    ),
    deal_health: <DealHealthCard health={dealState.health} numbers={dealState.numbers} />,
    red_flags: (
      <RedFlagsCard
        flags={dealState.redFlags}
        dismissedIds={dismissedFlagIds}
        onDismiss={onDismissFlag}
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
    information_gaps: <InformationGapsCard gaps={dealState.informationGaps} />,
    vehicle: <VehicleCard vehicle={dealState.vehicle} onCorrectField={onCorrectVehicleField} />,
    scorecard: <NegotiationScorecard scorecard={dealState.scorecard} numbers={dealState.numbers} />,
    checklist: <Checklist items={checklist} onToggle={onToggleChecklist} />,
  }

  const renderedWidgets = widgets
    .map((key) => ({ key, element: widgetComponents[key] }))
    .filter((w) => w.element !== null)

  const insightWidgets = (
    <YStack paddingHorizontal="$3.5" gap="$3.5" paddingVertical="$3">
      {renderedWidgets.map((widget) => (
        <YStack key={widget.key}>{widget.element}</YStack>
      ))}
    </YStack>
  )

  if (isSidebar) {
    return (
      <YStack flex={1}>
        <YStack paddingHorizontal="$4" paddingTop="$3" paddingBottom="$2">
          <DealPhaseIndicator currentPhase={dealState.phase} />
        </YStack>
        {insightWidgets}
      </YStack>
    )
  }

  return (
    <YStack flex={1}>
      <YStack
        paddingHorizontal="$4"
        paddingTop="$3"
        paddingBottom="$2"
        backgroundColor="$background"
      >
        <DealPhaseIndicator currentPhase={dealState.phase} />
      </YStack>
      {insightWidgets}
    </YStack>
  )
}
