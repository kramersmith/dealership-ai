import { useLayoutEffect, useRef, useState } from 'react'
import { Animated, type ViewStyle, type StyleProp } from 'react-native'
import { Text, type TextProps } from 'tamagui'

const SCRAMBLE_CHARS = '01ABCDEFGHIJKLMNOPQRSTUVWXYZ#$%&*+=?<>@!~'
const SCRAMBLE_FRAME_DURATION_MS = 18
const SCRAMBLE_SETTLE_MS = 24
const MIN_SCRAMBLE_FRAMES = 10
const MAX_SCRAMBLE_FRAMES = 18

function buildScrambledText(text: string, revealed = new Set<number>()) {
  return text
    .split('')
    .map((char, index) => {
      if (char === ' ') return ' '
      if (revealed.has(index)) return char
      return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]
    })
    .join('')
}

interface ScrambleTextProps extends TextProps {
  text: string
  active?: boolean
  containerStyle?: StyleProp<ViewStyle>
  animateOnMount?: boolean
}

export function ScrambleText({
  text,
  active = true,
  containerStyle,
  animateOnMount = true,
  ...props
}: ScrambleTextProps) {
  const [displayText, setDisplayText] = useState(() =>
    active && animateOnMount ? buildScrambledText(text) : text
  )
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didAnimateRef = useRef(false)

  useLayoutEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (startTimeoutRef.current) clearTimeout(startTimeoutRef.current)

    if (!active) {
      intervalRef.current = null
      timeoutRef.current = null
      startTimeoutRef.current = setTimeout(() => {
        setDisplayText(text)
        startTimeoutRef.current = null
      }, 0)
      return
    }

    if (!animateOnMount && !didAnimateRef.current) {
      didAnimateRef.current = true
      startTimeoutRef.current = setTimeout(() => {
        setDisplayText(text)
        startTimeoutRef.current = null
      }, 0)
      return
    }

    didAnimateRef.current = true
    startTimeoutRef.current = setTimeout(() => {
      setDisplayText(buildScrambledText(text))
      startTimeoutRef.current = null
    }, 0)

    const revealOrder = text
      .split('')
      .map((char, index) => ({ char, index, sort: char === ' ' ? -1 : Math.random() }))
      .sort((a, b) => a.sort - b.sort)
      .map((entry) => entry.index)

    let frame = 0
    const totalFrames = Math.min(
      Math.max(Math.ceil(text.length * 0.45), MIN_SCRAMBLE_FRAMES),
      MAX_SCRAMBLE_FRAMES
    )

    intervalRef.current = setInterval(() => {
      frame += 1
      const revealCount = Math.floor((frame / totalFrames) * text.length)
      const revealed = new Set(revealOrder.slice(0, revealCount))

      setDisplayText(buildScrambledText(text, revealed))

      if (frame >= totalFrames) {
        if (intervalRef.current) clearInterval(intervalRef.current)
        intervalRef.current = null
        setDisplayText(text)
      }
    }, SCRAMBLE_FRAME_DURATION_MS)

    timeoutRef.current = setTimeout(
      () => {
        setDisplayText(text)
        if (intervalRef.current) clearInterval(intervalRef.current)
        intervalRef.current = null
        timeoutRef.current = null
      },
      totalFrames * SCRAMBLE_FRAME_DURATION_MS + SCRAMBLE_SETTLE_MS
    )

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      if (startTimeoutRef.current) clearTimeout(startTimeoutRef.current)
      intervalRef.current = null
      timeoutRef.current = null
      startTimeoutRef.current = null
    }
  }, [active, animateOnMount, text])

  return (
    <Animated.View style={containerStyle}>
      <Text {...props}>{active ? displayText : text}</Text>
    </Animated.View>
  )
}
