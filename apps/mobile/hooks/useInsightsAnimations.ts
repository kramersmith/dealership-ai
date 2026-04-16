import { useCallback, useEffect, useRef } from 'react'
import { Animated, Easing, Platform } from 'react-native'
import * as Haptics from 'expo-haptics'

/** Pulse breathing-loop timing — shared by mobile strip and desktop dock. */
export const PULSE_RISE_MS = 520
export const PULSE_FALL_MS = 640

/** Signature entrance (content fade + slide) timing. */
const ENTRANCE_DURATION_MS = 340
const ENTRANCE_FROM_OPACITY = 0.62
const ENTRANCE_FROM_TRANSLATE_Y = 3

/** Finish flash haptic delay (rise duration + dwell). */
const FINISH_HAPTIC_DELAY_MS = 320 + 1000

/**
 * Pulsing brand-color overlay used while the insights panel is analyzing.
 * Loops 0 → 1 → 0; consumer maps the value to opacity for a brand layer.
 * Stopped (and zeroed) when `isActive` is false or motion is reduced.
 */
export function useBreathingPulseOverlay(isActive: boolean, prefersReducedMotion: boolean) {
  const overlayAnim = useRef(new Animated.Value(0)).current
  const loopRef = useRef<Animated.CompositeAnimation | null>(null)

  useEffect(() => {
    const stop = () => {
      loopRef.current?.stop()
      loopRef.current = null
      overlayAnim.setValue(0)
    }

    if (!isActive || prefersReducedMotion) {
      stop()
      return
    }

    overlayAnim.setValue(0)
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(overlayAnim, {
          toValue: 1,
          duration: PULSE_RISE_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
        Animated.timing(overlayAnim, {
          toValue: 0,
          duration: PULSE_FALL_MS,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: false,
        }),
      ]),
      { resetBeforeIteration: false }
    )
    loopRef.current = loop
    loop.start()

    return stop
  }, [isActive, overlayAnim, prefersReducedMotion])

  return overlayAnim
}

interface SignatureEntranceOptions {
  /** Native-driver-eligible surfaces only (true). Surfaces also animating layout
   *  props (e.g. dock width) on the same node should pass false. */
  useNativeDriver?: boolean
}

/**
 * Subtle "settle-in" of preview content (chips/headline) when the underlying
 * data signature changes. Skips the first prime + reduced-motion users.
 *
 * Returns `suppressNext()` for callers that want to treat the *next* signature
 * change as a no-op prime (e.g. a finish-flash already played the role of an
 * entrance, so don't double up).
 */
export function useSignatureEntranceAnimation(
  signature: string,
  prefersReducedMotion: boolean,
  { useNativeDriver = true }: SignatureEntranceOptions = {}
) {
  const opacityAnim = useRef(new Animated.Value(1)).current
  const translateYAnim = useRef(new Animated.Value(0)).current
  const animRef = useRef<Animated.CompositeAnimation | null>(null)
  const primedRef = useRef(false)
  const lastSigRef = useRef('')
  const skipNextRef = useRef(false)

  const suppressNext = useCallback(() => {
    skipNextRef.current = true
  }, [])

  useEffect(() => {
    animRef.current?.stop()
    animRef.current = null

    if (prefersReducedMotion) {
      opacityAnim.setValue(1)
      translateYAnim.setValue(0)
      primedRef.current = true
      lastSigRef.current = signature
      skipNextRef.current = false
      return
    }

    if (!primedRef.current) {
      primedRef.current = true
      lastSigRef.current = signature
      opacityAnim.setValue(1)
      translateYAnim.setValue(0)
      return
    }

    if (lastSigRef.current === signature) return
    lastSigRef.current = signature

    if (skipNextRef.current) {
      skipNextRef.current = false
      opacityAnim.setValue(1)
      translateYAnim.setValue(0)
      return
    }

    opacityAnim.setValue(ENTRANCE_FROM_OPACITY)
    translateYAnim.setValue(ENTRANCE_FROM_TRANSLATE_Y)
    const entrance = Animated.parallel([
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: ENTRANCE_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver,
      }),
      Animated.timing(translateYAnim, {
        toValue: 0,
        duration: ENTRANCE_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver,
      }),
    ])
    animRef.current = entrance
    entrance.start()

    return () => {
      entrance.stop()
    }
  }, [opacityAnim, prefersReducedMotion, signature, translateYAnim, useNativeDriver])

  return { opacityAnim, translateYAnim, suppressNext }
}

/**
 * Fires the post-finish-flash haptic on native platforms.
 * Returns a cancel function so the caller can clean up if the surface unmounts
 * or the flash is interrupted before the haptic fires.
 */
export function scheduleFinishFlashHaptic(): () => void {
  const timeoutId = setTimeout(() => {
    if (Platform.OS === 'web') return
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    } catch {
      /* simulator / unsupported */
    }
  }, FINISH_HAPTIC_DELAY_MS)
  return () => clearTimeout(timeoutId)
}

interface FinishFlashOptions {
  scaleAnim: Animated.Value
  borderWidthAnim: Animated.Value
  scaleTo: number
  borderWidthTo: number
  /** Whether scale animation runs on the native driver (false when paired with layout-driven props). */
  scaleUsesNativeDriver: boolean
  /** Optional extra animations to run in parallel with scale + border (e.g. color interp). */
  riseExtras?: Animated.CompositeAnimation[]
  fallExtras?: Animated.CompositeAnimation[]
  riseMs?: number
  dwellMs?: number
  fallMs?: number
}

/**
 * Builds the standard "settle" finish flash sequence:
 *   parallel(scale → scaleTo, borderWidth → borderWidthTo, ...riseExtras)
 *   delay(dwellMs)
 *   parallel(scale → 1, borderWidth → 1, ...fallExtras)
 *
 * Caller is responsible for resetting starting values, retaining the returned
 * composite (so it can be stopped on re-trigger), and scheduling the haptic
 * via {@link scheduleFinishFlashHaptic}.
 */
export function createFinishFlashSequence({
  scaleAnim,
  borderWidthAnim,
  scaleTo,
  borderWidthTo,
  scaleUsesNativeDriver,
  riseExtras = [],
  fallExtras = [],
  riseMs = 320,
  dwellMs = 1000,
  fallMs = 980,
}: FinishFlashOptions): Animated.CompositeAnimation {
  return Animated.sequence([
    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: scaleTo,
        duration: riseMs,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: scaleUsesNativeDriver,
      }),
      Animated.timing(borderWidthAnim, {
        toValue: borderWidthTo,
        duration: riseMs,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      ...riseExtras,
    ]),
    Animated.delay(dwellMs),
    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: fallMs,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: scaleUsesNativeDriver,
      }),
      Animated.timing(borderWidthAnim, {
        toValue: 1,
        duration: fallMs,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: false,
      }),
      ...fallExtras,
    ]),
  ])
}

/**
 * Convenience wrapper for surfaces whose finish flash is *only* scale + border
 * (no extra parallel animations, no manual coordination required). Manages the
 * composite ref + haptic schedule + reduced-motion reset internally.
 *
 * Returns a `trigger` callback. Caller picks when to fire it (e.g. after a
 * dock collapse animation completes).
 */
export function useScaleBorderFinishFlash({
  scaleTo,
  borderWidthTo,
  scaleUsesNativeDriver,
  prefersReducedMotion,
}: {
  scaleTo: number
  borderWidthTo: number
  scaleUsesNativeDriver: boolean
  prefersReducedMotion: boolean
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current
  const borderWidthAnim = useRef(new Animated.Value(1)).current
  const sequenceRef = useRef<Animated.CompositeAnimation | null>(null)
  const cancelHapticRef = useRef<(() => void) | null>(null)

  const stop = useCallback(() => {
    sequenceRef.current?.stop()
    sequenceRef.current = null
    cancelHapticRef.current?.()
    cancelHapticRef.current = null
  }, [])

  const trigger = useCallback(() => {
    stop()
    scaleAnim.setValue(1)
    borderWidthAnim.setValue(1)

    if (prefersReducedMotion) return

    cancelHapticRef.current = scheduleFinishFlashHaptic()

    const sequence = createFinishFlashSequence({
      scaleAnim,
      borderWidthAnim,
      scaleTo,
      borderWidthTo,
      scaleUsesNativeDriver,
    })
    sequenceRef.current = sequence
    sequence.start()
  }, [
    borderWidthAnim,
    borderWidthTo,
    prefersReducedMotion,
    scaleAnim,
    scaleTo,
    scaleUsesNativeDriver,
    stop,
  ])

  useEffect(() => stop, [stop])

  return { scaleAnim, borderWidthAnim, trigger, stop }
}
