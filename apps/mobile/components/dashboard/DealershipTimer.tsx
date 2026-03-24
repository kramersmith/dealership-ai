import { useState, useEffect } from 'react'
import { XStack, Text } from 'tamagui'
import { Clock } from '@tamagui/lucide-icons'
import { formatElapsedTime } from '@/lib/utils'
import { colors } from '@/lib/colors'

interface DealershipTimerProps {
  startedAt: string | null
}

export function DealershipTimer({ startedAt }: DealershipTimerProps) {
  const [elapsed, setElapsed] = useState('0:00')

  useEffect(() => {
    if (!startedAt) return

    const update = () => setElapsed(formatElapsedTime(startedAt))
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [startedAt])

  if (!startedAt) return null

  const start = new Date(startedAt).getTime()
  const minutes = Math.floor((Date.now() - start) / 60000)
  const isLong = minutes >= 120
  const isWarning = minutes >= 60

  return (
    <XStack
      alignItems="center"
      gap="$2"
      paddingHorizontal="$3"
      paddingVertical="$2"
      borderRadius="$2"
      backgroundColor={isLong ? colors.dangerSurfaceDark : isWarning ? colors.warningSurfaceDark : '$backgroundStrong'}
      borderWidth={1}
      borderColor={isLong ? colors.dangerBorderDark : isWarning ? colors.warningBorderDark : '$borderColor'}
    >
      <Clock size={14} color={isLong ? colors.danger : isWarning ? colors.warning : '$placeholderColor'} />
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
  )
}
