import { useRef, useEffect, useCallback } from 'react'
import { Animated } from 'react-native'
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

interface UseVisibilityTransitionOptions {
  visible?: boolean
  duration?: number
  hiddenOffsetY?: number
  animateOnMount?: boolean
}

/** Fade and slide vertically based on visibility. Keeps the API simple for mounted UI pieces. */
export function useVisibilityTransition({
  visible = true,
  duration = 240,
  hiddenOffsetY = 16,
  animateOnMount = false,
}: UseVisibilityTransitionOptions = {}) {
  const shouldStartHidden = visible && animateOnMount
  const opacity = useRef(new Animated.Value(shouldStartHidden ? 0 : visible ? 1 : 0)).current
  const translateY = useRef(
    new Animated.Value(shouldStartHidden ? hiddenOffsetY : visible ? 0 : hiddenOffsetY)
  ).current

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: visible ? 1 : 0,
        duration,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(translateY, {
        toValue: visible ? 0 : hiddenOffsetY,
        duration,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]).start()
  }, [duration, hiddenOffsetY, opacity, translateY, visible])

  return { opacity, translateY }
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

/** Rotate + fade in. Pass a trigger value (e.g. screen isFocused) to
 *  re-animate whenever it becomes truthy. Animates on mount by default. */
export function useIconEntrance(trigger: boolean = true, duration = 150) {
  const opacity = useRef(new Animated.Value(0)).current
  const rotation = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!trigger) return
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
  }, [trigger, opacity, rotation, duration])

  const rotate = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['-90deg', '0deg'],
  })

  return { opacity, rotate }
}

/** Animated border color that transitions on focus/blur.
 *  Returns { focused, onFocus, onBlur, borderColor } — spread onto the TextInput
 *  wrapper's Animated.View style. */
export function useFocusBorder(unfocusedColor: string, focusedColor: string, duration = 200) {
  const focused = useRef(false)
  const anim = useRef(new Animated.Value(0)).current

  const onFocus = useCallback(() => {
    focused.current = true
    Animated.timing(anim, {
      toValue: 1,
      duration,
      useNativeDriver: false, // border color can't use native driver
    }).start()
  }, [anim, duration])

  const onBlur = useCallback(() => {
    focused.current = false
    Animated.timing(anim, {
      toValue: 0,
      duration,
      useNativeDriver: false,
    }).start()
  }, [anim, duration])

  const borderColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [unfocusedColor, focusedColor],
  })

  return { onFocus, onBlur, borderColor }
}
