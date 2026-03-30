import { useRef } from 'react'
import { Animated, TouchableOpacity } from 'react-native'
import { XStack, YStack, Text } from 'tamagui'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { AppCard } from '@/components/shared'

interface ChecklistItem {
  label: string
  done: boolean
}

interface AiChecklistCardProps {
  title: string
  content: Record<string, any>
  onToggle?: (index: number) => void
}

function ChecklistRow({
  item,
  index,
  onToggle,
}: {
  item: ChecklistItem
  index: number
  onToggle?: (i: number) => void
}) {
  const scale = useRef(new Animated.Value(1)).current

  const handlePress = () => {
    if (!onToggle) return
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.95, duration: 80, useNativeDriver: USE_NATIVE_DRIVER }),
      Animated.timing(scale, { toValue: 1, duration: 80, useNativeDriver: USE_NATIVE_DRIVER }),
    ]).start()
    onToggle(index)
  }

  const interactive = !!onToggle

  const row = (
    <Animated.View style={{ transform: [{ scale }] }}>
      <XStack gap="$3" alignItems="center">
        <XStack
          width={22}
          height={22}
          borderRadius={6}
          borderWidth={2}
          borderColor={item.done ? '$brand' : '$placeholderColor'}
          backgroundColor={item.done ? '$brand' : 'transparent'}
          alignItems="center"
          justifyContent="center"
        >
          {item.done && (
            <Text color="$white" fontSize={13} fontWeight="700" marginTop={-1}>
              ✓
            </Text>
          )}
        </XStack>
        <Text
          flex={1}
          fontSize={13}
          color={item.done ? '$placeholderColor' : '$color'}
          textDecorationLine={item.done ? 'line-through' : 'none'}
        >
          {item.label}
        </Text>
      </XStack>
    </Animated.View>
  )

  if (interactive) {
    return (
      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={0.6}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        {row}
      </TouchableOpacity>
    )
  }

  return <YStack paddingVertical="$1.5">{row}</YStack>
}

export function AiChecklistCard({ title, content, onToggle }: AiChecklistCardProps) {
  const items = (content.items as ChecklistItem[]) ?? []

  if (items.length === 0) return null

  const doneCount = items.filter((item) => item.done).length

  return (
    <AppCard compact gap="$2">
      <XStack justifyContent="space-between" alignItems="center">
        <Text
          fontSize={12}
          fontWeight="600"
          color="$placeholderColor"
          textTransform="uppercase"
          letterSpacing={0.5}
        >
          {title}
        </Text>
        <Text fontSize={12} fontWeight="600" color="$placeholderColor">
          {doneCount}/{items.length}
        </Text>
      </XStack>
      <YStack gap="$1">
        {items.map((item, index) => (
          <ChecklistRow key={index} item={item} index={index} onToggle={onToggle} />
        ))}
      </YStack>
    </AppCard>
  )
}
