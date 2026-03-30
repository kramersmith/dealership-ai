import { useRef, useEffect } from 'react'
import { Animated } from 'react-native'
import { XStack, YStack, Text } from 'tamagui'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { AppCard } from '@/components/shared'

interface NumberRow {
  label: string
  value: string
  field?: string
  highlight?: 'good' | 'bad' | 'neutral'
  secondary?: boolean
}

interface NumberGroup {
  key: string
  rows: NumberRow[]
}

interface NumbersCardProps {
  title: string
  content: Record<string, any>
}

function NumberRowItem({ row }: { row: NumberRow }) {
  const flash = useRef(new Animated.Value(0)).current
  const isSecondary = !!row.secondary

  useEffect(() => {
    if (row.value !== '—') {
      flash.setValue(1)
      Animated.timing(flash, {
        toValue: 0,
        duration: 600,
        useNativeDriver: USE_NATIVE_DRIVER,
      }).start()
    }
  }, [row.value, flash])

  const valueColor =
    row.highlight === 'good' ? '$positive' : row.highlight === 'bad' ? '$danger' : undefined

  return (
    <Animated.View
      style={{ opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [1, 0.7] }) }}
    >
      <XStack justifyContent="space-between" alignItems="center" paddingVertical="$1.5">
        <Text fontSize={isSecondary ? 12 : 13} color="$placeholderColor" fontWeight="500">
          {row.label}
        </Text>
        <Text
          fontSize={isSecondary ? 12 : 14}
          fontWeight={isSecondary ? '500' : '700'}
          color={valueColor ?? '$color'}
        >
          {row.value}
        </Text>
      </XStack>
    </Animated.View>
  )
}

export function NumbersCard({ title, content }: NumbersCardProps) {
  const groups = (content.groups as NumberGroup[]) ?? []
  const rows = (content.rows as NumberRow[]) ?? []

  const allGroups: NumberGroup[] =
    groups.length > 0 ? groups : rows.length > 0 ? [{ key: 'default', rows }] : []

  if (allGroups.length === 0) return null

  return (
    <AppCard compact>
      <YStack gap="$3">
        <Text
          fontSize={12}
          fontWeight="600"
          color="$placeholderColor"
          textTransform="uppercase"
          letterSpacing={0.5}
        >
          {title}
        </Text>

        {allGroups.map((group, gi) => (
          <YStack key={group.key}>
            {gi > 0 && <YStack height={1} backgroundColor="$borderColor" marginVertical="$2" />}
            {group.rows.map((row) => (
              <NumberRowItem key={row.label} row={row} />
            ))}
          </YStack>
        ))}
      </YStack>
    </AppCard>
  )
}
