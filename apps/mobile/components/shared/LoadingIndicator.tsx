import { Animated } from 'react-native'
import { YStack, Spinner, Text } from 'tamagui'
import { useFadeIn } from '@/hooks/useAnimatedValue'

interface LoadingIndicatorProps {
  message?: string
}

export function LoadingIndicator({ message }: LoadingIndicatorProps) {
  const opacity = useFadeIn(300)

  return (
    <Animated.View style={{ flex: 1, opacity }}>
      <YStack flex={1} justifyContent="center" alignItems="center" gap="$3">
        {[
          <Spinner key="spin" size="large" color="$brand" />,
          message ? (
            <Text key="msg" color="$placeholderColor" fontSize={14}>
              {message}
            </Text>
          ) : null,
        ]}
      </YStack>
    </Animated.View>
  )
}
