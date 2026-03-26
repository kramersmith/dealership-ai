import { Platform, Animated } from 'react-native'
import { XStack, Text, Theme, YStack } from 'tamagui'
import type { DealHealth, DealNumbers, HealthStatus } from '@/lib/types'
import { computeBasicHealth } from '@/lib/dealComputations'
import { formatCurrency } from '@/lib/utils'
import { useFadeIn } from '@/hooks/useAnimatedValue'

interface DealHealthCardProps {
  health: DealHealth | null
  numbers: DealNumbers
}

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

function getBasicSummary(status: HealthStatus, numbers: DealNumbers): string {
  const { currentOffer, yourTarget, walkAwayPrice } = numbers
  if (currentOffer === null || yourTarget === null) return ''
  const diff = currentOffer - yourTarget
  if (status === 'good') return `Offer is ${formatCurrency(Math.abs(diff))} below your target`
  if (status === 'bad' && walkAwayPrice !== null)
    return `Offer is ${formatCurrency(currentOffer - walkAwayPrice)} above your walk-away`
  return `Offer is ${formatCurrency(diff)} above your target`
}

export function DealHealthCard({ health, numbers }: DealHealthCardProps) {
  const opacity = useFadeIn(300)

  const tier1Status = computeBasicHealth(numbers)
  const status = health?.status ?? tier1Status
  const summary = health?.summary ?? (status ? getBasicSummary(status, numbers) : null)

  if (!status) return null

  const themeName = STATUS_THEMES[status]

  return (
    <Animated.View style={{ opacity }}>
      <Theme name={themeName}>
        <YStack
          backgroundColor="$background"
          borderRadius={12}
          paddingHorizontal="$4"
          paddingVertical="$3.5"
          gap="$2"
          borderWidth={1}
          borderColor="$borderColor"
          {...(Platform.OS === 'web'
            ? { style: { boxShadow: '0 2px 8px rgba(0,0,0,0.25)' } }
            : {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.2,
                shadowRadius: 6,
                elevation: 3,
              })}
        >
          <XStack alignItems="center" gap="$2.5">
            <YStack width={10} height={10} borderRadius={5} backgroundColor="$color" />
            <Text fontSize={15} fontWeight="700" color="$color">
              {STATUS_LABELS[status]}
            </Text>
          </XStack>
          {summary ? (
            <Text fontSize={13} color="$color" opacity={0.85} lineHeight={20}>
              {summary}
            </Text>
          ) : null}
        </YStack>
      </Theme>
    </Animated.View>
  )
}
