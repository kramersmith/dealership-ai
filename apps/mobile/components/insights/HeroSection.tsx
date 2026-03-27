import { Platform } from 'react-native'
import { XStack, YStack, Text, Theme, useTheme } from 'tamagui'
import { Zap } from '@tamagui/lucide-icons'
import type { DealState, HealthStatus } from '@/lib/types'
import {
  computeBasicHealth,
  computeOfferDelta,
  getNextActionRecommendation,
} from '@/lib/dealComputations'
import { formatCurrency } from '@/lib/utils'
import { palette } from '@/lib/theme/tokens'
import { CompactPhaseIndicator } from './CompactPhaseIndicator'

const STATUS_LABELS: Record<HealthStatus, string> = {
  good: 'Good Deal',
  fair: 'Fair Deal',
  concerning: 'Concerning',
  bad: 'Bad Deal',
}

const STATUS_THEMES: Record<HealthStatus, 'success' | 'warning' | 'danger'> = {
  good: 'success',
  fair: 'warning',
  concerning: 'warning',
  bad: 'danger',
}

export { STATUS_LABELS, STATUS_THEMES }

interface HeroSectionProps {
  dealState: DealState
}

export function HeroSection({ dealState }: HeroSectionProps) {
  const theme = useTheme()
  const { health, numbers, phase } = dealState
  const tier1Status = computeBasicHealth(numbers)
  const status = health?.status ?? tier1Status
  const delta = computeOfferDelta(numbers)
  // AI-generated recommendation takes priority; frontend computation is fallback
  const recommendation = health?.recommendation ?? getNextActionRecommendation(dealState)

  const themeName = status ? STATUS_THEMES[status] : undefined
  const hasTheme = themeName != null

  const content = (
    <YStack
      backgroundColor={hasTheme ? '$background' : '$backgroundStrong'}
      borderRadius={12}
      paddingHorizontal="$4"
      paddingVertical="$3.5"
      gap="$3"
      borderWidth={1}
      borderColor="$borderColor"
      {...(Platform.OS === 'web'
        ? { style: { boxShadow: `0 2px 8px ${theme.shadowColor?.val ?? palette.overlay}` } }
        : {
            shadowColor: (theme.shadowColor?.val as string) ?? palette.overlay,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 1,
            shadowRadius: 6,
            elevation: 3,
          })}
    >
      {/* Row 1: Status + Phase */}
      <XStack alignItems="center" justifyContent="space-between" gap="$4">
        {status ? (
          <XStack alignItems="center" gap="$2" flexShrink={0}>
            <YStack
              width={10}
              height={10}
              borderRadius={5}
              backgroundColor={hasTheme ? '$color' : '$brand'}
            />
            <Text fontSize={15} fontWeight="700" color={hasTheme ? '$color' : '$brand'}>
              {STATUS_LABELS[status]}
            </Text>
          </XStack>
        ) : (
          <YStack />
        )}
        <CompactPhaseIndicator currentPhase={phase} />
      </XStack>

      {/* Row 2: Offer delta — the hero number */}
      {delta && (
        <YStack>
          <Text
            fontSize={22}
            fontWeight="800"
            color={
              delta.direction === 'below'
                ? '$positive'
                : delta.direction === 'above'
                  ? hasTheme
                    ? '$color'
                    : '$danger'
                  : '$color'
            }
            lineHeight={28}
          >
            {formatCurrency(delta.amount)}{' '}
            <Text fontSize={14} fontWeight="600" color={hasTheme ? '$color' : '$placeholderColor'}>
              {delta.direction === 'at' ? 'at target' : `${delta.direction} target`}
            </Text>
          </Text>
        </YStack>
      )}

      {/* Row 3: AI recommendation */}
      {recommendation && (
        <XStack
          backgroundColor={hasTheme ? '$borderColor' : '$backgroundHover'}
          borderRadius={8}
          paddingHorizontal="$3"
          paddingVertical="$2.5"
          gap="$2"
          alignItems="center"
        >
          <Zap size={14} color={hasTheme ? '$color' : '$brand'} />
          <Text fontSize={13} fontWeight="600" color="$color" flex={1} lineHeight={18}>
            {recommendation}
          </Text>
        </XStack>
      )}
    </YStack>
  )

  return hasTheme ? <Theme name={themeName}>{content}</Theme> : content
}
