import { YStack, Spinner, Text } from 'tamagui'
import { colors } from '@/lib/colors'

interface LoadingIndicatorProps {
  message?: string
}

export function LoadingIndicator({ message }: LoadingIndicatorProps) {
  return (
    <YStack flex={1} justifyContent="center" alignItems="center" gap="$3">
      <Spinner size="large" color={colors.brand} />
      {message && (
        <Text color="$placeholderColor" fontSize={14}>
          {message}
        </Text>
      )}
    </YStack>
  )
}
