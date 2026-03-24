import { useState, useCallback } from 'react'
import { ScrollView, TouchableOpacity } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { ChevronDown, ChevronUp } from '@tamagui/lucide-icons'
import type { DealState } from '@/lib/types'
import { DealPhaseIndicator } from './DealPhaseIndicator'
import { NumbersDashboard } from './NumbersDashboard'
import { NegotiationScorecard } from './NegotiationScorecard'
import { VehicleCard } from './VehicleCard'
import { Checklist } from './Checklist'
import { DealershipTimer } from './DealershipTimer'

interface DashboardPanelProps {
  dealState: DealState
  onToggleChecklist: (index: number) => void
  mode?: 'mobile' | 'sidebar'
}

export function DashboardPanel({ dealState, onToggleChecklist, mode = 'mobile' }: DashboardPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const isSidebar = mode === 'sidebar'

  const toggle = useCallback(() => {
    setIsExpanded((prev) => !prev)
  }, [])

  const hasNumbers = Object.values(dealState.numbers).some((v) => v !== null)
  const hasScorecard = Object.values(dealState.scorecard).some((v) => v !== null)
  const hasContent = dealState.vehicle || hasNumbers || hasScorecard || dealState.checklist.length > 0 || dealState.timerStartedAt

  const dashboardWidgets = (
    <YStack paddingHorizontal="$4" gap="$3" paddingVertical="$3">
      {dealState.timerStartedAt && (
        <DealershipTimer startedAt={dealState.timerStartedAt} />
      )}

      {dealState.vehicle && (
        <VehicleCard vehicle={dealState.vehicle} />
      )}

      {hasNumbers && (
        <NumbersDashboard numbers={dealState.numbers} />
      )}

      {hasScorecard && (
        <NegotiationScorecard
          scorecard={dealState.scorecard}
          numbers={dealState.numbers}
        />
      )}

      <Checklist
        items={dealState.checklist}
        onToggle={onToggleChecklist}
      />
    </YStack>
  )

  // Sidebar mode (desktop): always expanded, no toggle, no max height
  if (isSidebar) {
    return (
      <YStack flex={1}>
        <YStack paddingHorizontal="$4" paddingTop="$3" paddingBottom="$2">
          <DealPhaseIndicator currentPhase={dealState.phase} />
        </YStack>
        {dashboardWidgets}
      </YStack>
    )
  }

  // Mobile mode: collapsible with max height
  return (
    <YStack>
      {/* Phase indicator always visible */}
      <YStack paddingHorizontal="$4" paddingTop="$2" paddingBottom="$2" backgroundColor="$background">
        <DealPhaseIndicator currentPhase={dealState.phase} />
      </YStack>

      {/* Collapse toggle */}
      {hasContent && (
        <TouchableOpacity
          onPress={toggle}
          activeOpacity={0.6}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <XStack
            justifyContent="center"
            alignItems="center"
            gap="$1"
          >
            <Text fontSize={12} color="$placeholderColor" fontWeight="500">
              {isExpanded ? 'Hide Dashboard' : 'Show Dashboard'}
            </Text>
            {isExpanded ? (
              <ChevronUp size={16} color="$placeholderColor" />
            ) : (
              <ChevronDown size={16} color="$placeholderColor" />
            )}
          </XStack>
        </TouchableOpacity>
      )}

      {/* Collapsible content */}
      {isExpanded && hasContent && (
        <ScrollView
          style={{ maxHeight: 400 }}
          showsVerticalScrollIndicator={false}
        >
          {dashboardWidgets}
        </ScrollView>
      )}
    </YStack>
  )
}
