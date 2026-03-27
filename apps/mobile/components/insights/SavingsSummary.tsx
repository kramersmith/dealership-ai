import { Text, Theme } from 'tamagui'
import { formatCurrency } from '@/lib/utils'
import { computeSavings } from '@/lib/dealComputations'
import { AppCard } from '@/components/shared'

interface SavingsSummaryProps {
  firstOffer: number | null
  currentOffer: number | null
  savingsEstimate: number | null
}

export function SavingsSummary({ firstOffer, currentOffer, savingsEstimate }: SavingsSummaryProps) {
  // Tier 2 (AI-assessed) overrides Tier 1 (frontend-derived)
  const tier1Savings = computeSavings(firstOffer, currentOffer)
  const savings = savingsEstimate ?? tier1Savings

  if (savings === null || savings <= 0) return null

  return (
    <Theme name="success">
      <AppCard alignItems="center" gap="$2">
        <Text fontSize={12} fontWeight="600" color="$color" opacity={0.8}>
          Estimated Savings
        </Text>
        <Text fontSize={28} fontWeight="800" color="$color">
          {formatCurrency(savings)}
        </Text>
        <Text fontSize={12} color="$color" opacity={0.7}>
          vs. dealer's first offer
        </Text>
      </AppCard>
    </Theme>
  )
}
