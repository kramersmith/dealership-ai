import { Animated } from 'react-native'
import { YStack, Spinner, Text } from 'tamagui'
import { colors } from '@/lib/colors'
import { useFadeIn } from '@/hooks/useAnimatedValue'

interface LoadingIndicatorProps {
  message?: string
}

export function LoadingIndicator({ message }: LoadingIndicatorProps) {
  const opacity = useFadeIn(300)

  return (
    <Animated.View style={{ flex: 1, opacity }}>
      <YStack flex={1} justifyContent="center" alignItems="center" gap="$3">
        <Spinner size="large" color={colors.brand} />
        {message && (
          <Text color="$placeholderColor" fontSize={14}>
            {message}
          </Text>
        )}
      </YStack>
    </Animated.View>
  )
}
