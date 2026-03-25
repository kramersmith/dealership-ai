import { YStack } from 'tamagui'
import type { DealState } from '@/lib/types'
import { DEFAULT_BUYER_CONTEXT, WIDGET_ORDER_BY_CONTEXT } from '@/lib/constants'
import { DealPhaseIndicator } from './DealPhaseIndicator'
import { NumbersSummary } from './NumbersSummary'
import { NegotiationScorecard } from './NegotiationScorecard'
import { VehicleCard } from './VehicleCard'
import { Checklist } from './Checklist'
import { DealershipTimer } from './DealershipTimer'

interface InsightsPanelProps {
  dealState: DealState
  onToggleChecklist: (index: number) => void
  mode?: 'mobile' | 'sidebar'
}

export function InsightsPanel({
  dealState,
  onToggleChecklist,
  mode = 'mobile',
}: InsightsPanelProps) {
  const isSidebar = mode === 'sidebar'

  const hasNumbers = Object.values(dealState.numbers).some((value) => value !== null)
  const hasScorecard = Object.values(dealState.scorecard).some((value) => value !== null)

  // Build widgets in order determined by buyer context
  const widgets: { key: string; element: React.ReactNode }[] = []

  // Timer always first if active
  if (dealState.timerStartedAt) {
    widgets.push({
      key: 'timer',
      element: <DealershipTimer startedAt={dealState.timerStartedAt} />,
    })
  }

  const widgetMap: Record<string, { key: string; element: React.ReactNode } | null> = {
    vehicle: dealState.vehicle
      ? { key: 'vehicle', element: <VehicleCard vehicle={dealState.vehicle} /> }
      : null,
    numbers: hasNumbers
      ? { key: 'numbers', element: <NumbersSummary numbers={dealState.numbers} /> }
      : null,
    scorecard: hasScorecard
      ? {
          key: 'scorecard',
          element: (
            <NegotiationScorecard scorecard={dealState.scorecard} numbers={dealState.numbers} />
          ),
        }
      : null,
    checklist: {
      key: 'checklist',
      element: <Checklist items={dealState.checklist} onToggle={onToggleChecklist} />,
    },
  }

  // Order based on buyer context (data-driven via WIDGET_ORDER_BY_CONTEXT)
  const order =
    WIDGET_ORDER_BY_CONTEXT[dealState.buyerContext] ??
    WIDGET_ORDER_BY_CONTEXT[DEFAULT_BUYER_CONTEXT]

  for (const widgetKey of order) {
    const widget = widgetMap[widgetKey]
    if (widget) widgets.push(widget)
  }

  const insightWidgets = (
    <YStack paddingHorizontal="$4" gap="$3" paddingVertical="$3">
      {widgets.map((widget) => (
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
