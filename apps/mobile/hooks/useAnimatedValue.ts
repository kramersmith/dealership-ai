import { useRef, useEffect, useCallback } from 'react'
import { Animated } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { USE_NATIVE_DRIVER } from '@/lib/platform'

/** Animates a numeric value smoothly when it changes */
export function useAnimatedNumber(value: number, duration = 300) {
  const anim = useRef(new Animated.Value(value)).current

  useEffect(() => {
    Animated.timing(anim, {
      toValue: value,
      duration,
      useNativeDriver: false, // layout props can't use native driver
    }).start()
  }, [value, anim, duration])

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
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start()
  }, [opacity, duration, delay])

  return opacity
}

/** Fade + slide up on mount. Pass duration=0 to start fully visible (no animation). */
export function useSlideIn(duration = 300, delay = 0) {
  const skip = duration === 0
  const opacity = useRef(new Animated.Value(skip ? 1 : 0)).current
  const translateY = useRef(new Animated.Value(skip ? 0 : 12)).current

  useEffect(() => {
    if (skip) return
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration,
        delay,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration,
        delay,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]).start()
  }, [opacity, translateY, duration, delay, skip])

  return { opacity, translateY }
}

/** Rotate + fade in on focus — used to fake icon morphing across screens.
 *  Re-fires every time the screen gains focus (including back navigation). */
export function useIconEntrance(duration = 150) {
  const opacity = useRef(new Animated.Value(0)).current
  const rotation = useRef(new Animated.Value(0)).current

  // useFocusEffect fires on mount AND when the screen regains focus
  // (e.g. navigating back from another screen)
  useFocusEffect(
    useCallback(() => {
      opacity.setValue(0)
      rotation.setValue(0)
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(rotation, {
          toValue: 1,
          duration,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]).start()
    }, [opacity, rotation, duration])
  )

  const rotate = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['-90deg', '0deg'],
  })

  return { opacity, rotate }
}

/** Staggered fade + slide in — delay based on index for sequential entrance */
export function useStaggeredFadeIn(index: number, staggerMs = 50, duration = 250) {
  const opacity = useRef(new Animated.Value(0)).current
  const translateY = useRef(new Animated.Value(8)).current

  useEffect(() => {
    const delay = index * staggerMs
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration,
        delay,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration,
        delay,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]).start()
  }, [opacity, translateY, index, staggerMs, duration])

  return { opacity, translateY }
}

/** Pulse effect — scale up then back */
export function usePulse(trigger: boolean) {
  const scale = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (trigger) {
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.05,
          duration: 150,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(scale, { toValue: 1, duration: 150, useNativeDriver: USE_NATIVE_DRIVER }),
        Animated.timing(scale, {
          toValue: 1.05,
          duration: 150,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(scale, { toValue: 1, duration: 150, useNativeDriver: USE_NATIVE_DRIVER }),
      ]).start()
    }
  }, [trigger, scale])

  return scale
}
