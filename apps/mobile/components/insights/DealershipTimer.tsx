import { useState, useEffect, useRef } from 'react'
import { Animated } from 'react-native'
import { XStack, Text, Theme } from 'tamagui'
import { Clock } from '@tamagui/lucide-icons'
import { formatElapsedTime } from '@/lib/utils'
import { TIMER_WARNING_MINUTES, TIMER_LONG_MINUTES } from '@/lib/constants'
import { USE_NATIVE_DRIVER } from '@/lib/platform'

interface DealershipTimerProps {
  startedAt: string | null
}

export function DealershipTimer({ startedAt }: DealershipTimerProps) {
  const [elapsed, setElapsed] = useState('0:00')
  const [minutes, setMinutes] = useState(0)
  const scale = useRef(new Animated.Value(1)).current
  const prevWarning = useRef(false)
  const prevLong = useRef(false)

  useEffect(() => {
    if (!startedAt) return

    const update = () => {
      setElapsed(formatElapsedTime(startedAt))
      const start = new Date(startedAt).getTime()
      setMinutes(Math.floor((Date.now() - start) / 60000))
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [startedAt])

  // Pulse when crossing thresholds
  const isWarning = minutes >= TIMER_WARNING_MINUTES
  const isLong = minutes >= TIMER_LONG_MINUTES

  useEffect(() => {
    const shouldPulse = (isWarning && !prevWarning.current) || (isLong && !prevLong.current)
    prevWarning.current = isWarning
    prevLong.current = isLong

    if (shouldPulse) {
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.06,
          duration: 120,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: USE_NATIVE_DRIVER }),
        Animated.timing(scale, {
          toValue: 1.06,
          duration: 120,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: USE_NATIVE_DRIVER }),
      ]).start()
    }
  }, [isWarning, isLong, scale])

  if (!startedAt) return null

  const timerTheme = isLong ? 'danger' : isWarning ? 'warning' : undefined
  const hasTheme = timerTheme != null

  const content = (
    <Animated.View style={{ transform: [{ scale }], alignSelf: 'flex-start' }}>
      <XStack
        alignItems="center"
        gap="$2"
        paddingHorizontal="$3"
        paddingVertical="$2"
        borderRadius="$2"
        backgroundColor={hasTheme ? '$background' : '$backgroundStrong'}
        borderWidth={1}
        borderColor="$borderColor"
      >
        <Clock size={14} color={hasTheme ? '$color' : '$placeholderColor'} />
        <Text
          fontSize={13}
          fontWeight="600"
          color={hasTheme ? '$color' : '$placeholderColor'}
          fontVariant={['tabular-nums']}
        >
          {elapsed}
        </Text>
        {isLong && (
          <Text fontSize={11} color="$color">
            Long wait — could be a tactic
          </Text>
        )}
      </XStack>
    </Animated.View>
  )

  return timerTheme ? <Theme name={timerTheme}>{content}</Theme> : content
}
