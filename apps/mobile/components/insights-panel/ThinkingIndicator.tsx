import { useRef, useEffect } from 'react'
import { Animated } from 'react-native'
import { XStack, Text, useTheme } from 'tamagui'
import { USE_NATIVE_DRIVER } from '@/lib/platform'

const PULSE_DURATION = 1200

export function ThinkingIndicator() {
  const theme = useTheme()
  const brandColor = theme.brand?.val as string
  const opacity = useRef(new Animated.Value(0)).current
  const dotOpacity = useRef(new Animated.Value(0.3)).current
  const animRef = useRef<Animated.CompositeAnimation | null>(null)

  // Fade in
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start()

    // Pulsing dot loop
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(dotOpacity, {
          toValue: 1,
          duration: PULSE_DURATION / 2,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(dotOpacity, {
          toValue: 0.3,
          duration: PULSE_DURATION / 2,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ])
    )
    animRef.current = pulse
    pulse.start()

    return () => {
      pulse.stop()
    }
  }, [opacity, dotOpacity])

  return (
    <Animated.View style={{ opacity, flexDirection: 'row', alignItems: 'center' }}>
      <XStack alignItems="center" gap="$1.5">
        <Animated.View
          style={{
            width: 5,
            height: 5,
            borderRadius: 2.5,
            backgroundColor: brandColor,
            opacity: dotOpacity,
          }}
        />
        <Text fontSize={11} color="$placeholderColor" fontWeight="500">
          Analyzing
        </Text>
      </XStack>
    </Animated.View>
  )
}
