import { XStack, YStack, Text } from 'tamagui'
import type { DealNumbers } from '@/lib/types'
import { formatCurrency, formatPercent } from '@/lib/utils'
import { colors } from '@/lib/colors'
import { AppCard } from '@/components/shared'

interface NumbersDashboardProps {
  numbers: DealNumbers
}

interface NumberCellProps {
  label: string
  value: string
  highlight?: 'good' | 'bad' | 'neutral'
}

function NumberCell({ label, value, highlight = 'neutral' }: NumberCellProps) {
  const valueColor =
    highlight === 'good' ? colors.positive :
    highlight === 'bad' ? colors.danger :
    undefined

  return (
    <YStack flex={1} gap="$1">
      <Text fontSize={11} color="$placeholderColor" fontWeight="500" numberOfLines={1}>
        {label}
      </Text>
      <Text fontSize={17} fontWeight="700" color={valueColor ?? '$color'} numberOfLines={1}>
        {value}
      </Text>
    </YStack>
  )
}

export function NumbersDashboard({ numbers }: NumbersDashboardProps) {
  const { msrp, yourTarget, walkAwayPrice, currentOffer, monthlyPayment, apr } = numbers

  const offerHighlight =
    currentOffer === null || yourTarget === null ? 'neutral' :
    currentOffer <= yourTarget ? 'good' :
    walkAwayPrice !== null && currentOffer > walkAwayPrice ? 'bad' :
    'neutral'

  const aprHighlight =
    apr === null ? 'neutral' :
    apr <= 6.5 ? 'good' :
    apr >= 9 ? 'bad' :
    'neutral'

  return (
    <AppCard gap="$3">
      <XStack gap="$4">
        <NumberCell label="Asking / MSRP" value={formatCurrency(msrp)} />
        <NumberCell label="Your Target" value={formatCurrency(yourTarget)} highlight="good" />
        <NumberCell label="Walk-Away" value={formatCurrency(walkAwayPrice)} highlight="bad" />
      </XStack>
      <XStack gap="$4">
        <NumberCell label="Current Offer" value={formatCurrency(currentOffer)} highlight={offerHighlight} />
        <NumberCell label="Monthly" value={formatCurrency(monthlyPayment)} />
        <NumberCell label="APR" value={formatPercent(apr)} highlight={aprHighlight} />
      </XStack>
    </AppCard>
  )
}
