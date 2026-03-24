import { useState, useEffect, useRef } from 'react'
import { Animated, Platform } from 'react-native'
const useNative = Platform.OS !== 'web'
import { XStack, Text } from 'tamagui'
import { Clock } from '@tamagui/lucide-icons'
import { formatElapsedTime } from '@/lib/utils'
import { colors } from '@/lib/colors'

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
  const isWarning = minutes >= 60
  const isLong = minutes >= 120

  useEffect(() => {
    const shouldPulse = (isWarning && !prevWarning.current) || (isLong && !prevLong.current)
    prevWarning.current = isWarning
    prevLong.current = isLong

    if (shouldPulse) {
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.06, duration: 120, useNativeDriver: useNative }),
        Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: useNative }),
        Animated.timing(scale, { toValue: 1.06, duration: 120, useNativeDriver: useNative }),
        Animated.timing(scale, { toValue: 1, duration: 120, useNativeDriver: useNative }),
      ]).start()
    }
  }, [isWarning, isLong])

  if (!startedAt) return null

  return (
    <Animated.View style={{ transform: [{ scale }], alignSelf: 'flex-start' }}>
      <XStack
        alignItems="center"
        gap="$2"
        paddingHorizontal="$3"
        paddingVertical="$2"
        borderRadius="$2"
        backgroundColor={
          isLong
            ? colors.dangerSurfaceDark
            : isWarning
              ? colors.warningSurfaceDark
              : '$backgroundStrong'
        }
        borderWidth={1}
        borderColor={
          isLong ? colors.dangerBorderDark : isWarning ? colors.warningBorderDark : '$borderColor'
        }
      >
        <Clock
          size={14}
          color={isLong ? colors.danger : isWarning ? colors.warning : '$placeholderColor'}
        />
        <Text
          fontSize={13}
          fontWeight="600"
          color={isLong ? colors.danger : isWarning ? colors.warning : '$placeholderColor'}
          fontVariant={['tabular-nums']}
        >
          {elapsed}
        </Text>
        {isLong && (
          <Text fontSize={11} color={colors.danger}>
            Long wait — could be a tactic
          </Text>
        )}
      </XStack>
    </Animated.View>
  )
}
