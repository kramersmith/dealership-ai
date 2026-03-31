import { YStack, XStack, Text } from 'tamagui'
import type { NegotiationContext, NegotiationStance } from '@/lib/types'

interface SituationBarProps {
  context: NegotiationContext
}

const STANCE_COLORS: Record<NegotiationStance, string> = {
  researching: '$brand',
  preparing: '$brand',
  engaging: '$brand',
  negotiating: '$brand',
  holding: '$warning',
  walking: '$warning',
  waiting: '$warning',
  financing: '$positive',
  closing: '$positive',
  post_purchase: '$positive',
}

const STANCE_LABELS: Record<NegotiationStance, string> = {
  researching: 'Researching',
  preparing: 'Preparing',
  engaging: 'Engaging',
  negotiating: 'Negotiating',
  holding: 'Holding',
  walking: 'Walked Away',
  waiting: 'Waiting',
  financing: 'Financing',
  closing: 'Closing',
  post_purchase: 'Complete',
}

export function SituationBar({ context }: SituationBarProps) {
  const color = STANCE_COLORS[context.stance] ?? '$placeholderColor'
  const label = STANCE_LABELS[context.stance] ?? context.stance

  return (
    <YStack
      backgroundColor="$backgroundHover"
      borderRadius={10}
      paddingHorizontal="$3"
      paddingVertical="$2.5"
      gap="$1.5"
    >
      <XStack>
        <XStack
          backgroundColor={color}
          borderRadius={4}
          paddingHorizontal="$1.5"
          paddingVertical="$0.5"
        >
          <Text fontSize={10} fontWeight="700" color="$white" textTransform="uppercase">
            {label}
          </Text>
        </XStack>
      </XStack>
      <Text fontSize={12} color="$color" lineHeight={18}>
        {context.situation}
      </Text>
    </YStack>
  )
}
