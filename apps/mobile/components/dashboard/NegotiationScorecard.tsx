import { XStack, YStack, Text } from 'tamagui'
import type { Scorecard, DealNumbers } from '@/lib/types'
import { SCORE_COLORS } from '@/lib/constants'
import { colors } from '@/lib/colors'
import { StatusPill, AppCard } from '@/components/shared'

interface NegotiationScorecardProps {
  scorecard: Scorecard
  numbers: DealNumbers
}

interface ScoreItemProps {
  label: string
  status: 'red' | 'yellow' | 'green' | null
}

function ScoreItem({ label, status }: ScoreItemProps) {
  return (
    <YStack alignItems="center" gap="$1">
      <StatusPill status={status} size="sm" />
      <Text fontSize={10} color="$placeholderColor" fontWeight="500">
        {label}
      </Text>
    </YStack>
  )
}

export function NegotiationScorecard({ scorecard, numbers }: NegotiationScorecardProps) {
  const { yourTarget, currentOffer, walkAwayPrice } = numbers

  let progressPercent = 50
  if (yourTarget !== null && walkAwayPrice !== null && currentOffer !== null && walkAwayPrice > yourTarget) {
    const range = walkAwayPrice - yourTarget
    const position = currentOffer - yourTarget
    progressPercent = Math.max(0, Math.min(100, (position / range) * 100))
  }

  const progressColor =
    progressPercent <= 33 ? SCORE_COLORS.green :
    progressPercent <= 66 ? SCORE_COLORS.yellow :
    SCORE_COLORS.red

  return (
    <AppCard gap="$3">
      <XStack justifyContent="space-around">
        <ScoreItem label="Price" status={scorecard.price} />
        <ScoreItem label="Finance" status={scorecard.financing} />
        <ScoreItem label="Trade-In" status={scorecard.tradeIn} />
        <ScoreItem label="Fees" status={scorecard.fees} />
        <ScoreItem label="Overall" status={scorecard.overall} />
      </XStack>

      {yourTarget !== null && currentOffer !== null && (
        <YStack gap="$1">
          <XStack
            height={6}
            backgroundColor="$borderColor"
            borderRadius={100}
            overflow="hidden"
          >
            <XStack
              width={`${100 - progressPercent}%`}
              height="100%"
              backgroundColor={progressColor}
              borderRadius={100}
            />
          </XStack>
          <XStack justifyContent="space-between">
            <Text fontSize={10} color={colors.positive} fontWeight="600">
              Target
            </Text>
            <Text fontSize={10} color="$placeholderColor" fontWeight="500">
              Current
            </Text>
            <Text fontSize={10} color={colors.danger} fontWeight="600">
              Walk-Away
            </Text>
          </XStack>
        </YStack>
      )}
    </AppCard>
  )
}
