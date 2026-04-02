import { Animated } from 'react-native'
import { YStack, Text, Theme } from 'tamagui'
import { useFadeIn } from '@/hooks/useAnimatedValue'

export function AnimatedError({ message }: { message: string }) {
  const opacity = useFadeIn(250)
  return (
    <Animated.View style={{ opacity }}>
      <Theme name="danger">
        <YStack
          backgroundColor="$background"
          borderColor="$borderColor"
          borderWidth={1}
          borderRadius="$3"
          padding="$3"
        >
          <Text color="$color" fontSize={14}>
            {message}
          </Text>
        </YStack>
      </Theme>
    </Animated.View>
  )
}
