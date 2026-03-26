import { XStack, Text } from 'tamagui'
import type { ScoreStatus } from '@/lib/types'

const STATUS_TOKEN = {
  red: '$danger',
  yellow: '$warning',
  green: '$positive',
} as const

interface StatusPillProps {
  status: ScoreStatus
  label?: string
  size?: 'sm' | 'md'
}

export function StatusPill({ status, label, size = 'md' }: StatusPillProps) {
  if (!status) return null

  const bgColor = STATUS_TOKEN[status]
  const isSmall = size === 'sm'

  return (
    <XStack
      backgroundColor={bgColor}
      borderRadius={100}
      paddingHorizontal={isSmall ? '$2' : '$3'}
      paddingVertical={isSmall ? '$1' : '$1'}
      alignItems="center"
      gap="$1"
    >
      {label && (
        <Text color="$white" fontSize={isSmall ? 11 : 13} fontWeight="600">
          {label}
        </Text>
      )}
      {!label && (
        <XStack
          width={isSmall ? 8 : 10}
          height={isSmall ? 8 : 10}
          borderRadius={100}
          backgroundColor="$white"
          opacity={0.9}
        />
      )}
    </XStack>
  )
}
