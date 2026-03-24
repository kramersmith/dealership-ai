import { useRef, useEffect } from 'react'
import { Animated, Platform } from 'react-native'

// On web, useNativeDriver is not supported — fall back to JS driver silently
const useNative = Platform.OS !== 'web'

/** Animates a numeric value smoothly when it changes */
export function useAnimatedNumber(value: number, duration = 300) {
  const anim = useRef(new Animated.Value(value)).current

  useEffect(() => {
    Animated.timing(anim, {
      toValue: value,
      duration,
      useNativeDriver: false, // layout props can't use native driver
    }).start()
  }, [value])

  return anim
}

/** Fade in on mount */
export function useFadeIn(duration = 400, delay = 0) {
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration,
      delay,
      useNativeDriver: useNative,
    }).start()
  }, [])

  return opacity
}

/** Fade + slide up on mount */
export function useSlideIn(duration = 300, delay = 0) {
  const opacity = useRef(new Animated.Value(0)).current
  const translateY = useRef(new Animated.Value(12)).current

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration,
        delay,
        useNativeDriver: useNative,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration,
        delay,
        useNativeDriver: useNative,
      }),
    ]).start()
  }, [])

  return { opacity, translateY }
}

/** Pulse effect — scale up then back */
export function usePulse(trigger: boolean) {
  const scale = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (trigger) {
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.05, duration: 150, useNativeDriver: useNative }),
        Animated.timing(scale, { toValue: 1, duration: 150, useNativeDriver: useNative }),
        Animated.timing(scale, { toValue: 1.05, duration: 150, useNativeDriver: useNative }),
        Animated.timing(scale, { toValue: 1, duration: 150, useNativeDriver: useNative }),
      ]).start()
    }
  }, [trigger])

  return scale
}
