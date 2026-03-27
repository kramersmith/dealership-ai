import { useRef } from 'react'
import { Animated, TouchableOpacity } from 'react-native'
import { XStack, YStack, Text } from 'tamagui'
import type { ChecklistItem } from '@/lib/types'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { AppCard, SectionHeader } from '@/components/shared'

interface ChecklistProps {
  items: ChecklistItem[]
  onToggle: (index: number) => void
}

function ChecklistRow({
  item,
  index,
  onToggle,
}: {
  item: ChecklistItem
  index: number
  onToggle: (i: number) => void
}) {
  const scale = useRef(new Animated.Value(1)).current

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.95, duration: 80, useNativeDriver: USE_NATIVE_DRIVER }),
      Animated.timing(scale, { toValue: 1, duration: 80, useNativeDriver: USE_NATIVE_DRIVER }),
    ]).start()
    onToggle(index)
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.7}
      style={{ minHeight: 44, justifyContent: 'center' }}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <XStack gap="$3" alignItems="center">
          <XStack
            width={24}
            height={24}
            borderRadius={6}
            borderWidth={2}
            borderColor={item.done ? '$brand' : '$placeholderColor'}
            backgroundColor={item.done ? '$brand' : 'transparent'}
            alignItems="center"
            justifyContent="center"
          >
            {item.done && (
              <Text color="$white" fontSize={14} fontWeight="700" marginTop={-1}>
                ✓
              </Text>
            )}
          </XStack>
          <Text
            flex={1}
            fontSize={15}
            color={item.done ? '$placeholderColor' : '$color'}
            textDecorationLine={item.done ? 'line-through' : 'none'}
          >
            {item.label}
          </Text>
        </XStack>
      </Animated.View>
    </TouchableOpacity>
  )
}

export function Checklist({ items, onToggle }: ChecklistProps) {
  if (items.length === 0) {
    return (
      <AppCard compact>
        <Text fontSize={13} color="$placeholderColor" textAlign="center">
          Your checklist will appear here as the AI identifies things to check.
        </Text>
      </AppCard>
    )
  }

  const doneCount = items.filter((item) => item.done).length

  return (
    <AppCard compact gap="$2">
      <SectionHeader title="Checklist" action={`${doneCount}/${items.length}`} />
      <YStack gap="$1">
        {items.map((item, index) => (
          <ChecklistRow key={index} item={item} index={index} onToggle={onToggle} />
        ))}
      </YStack>
    </AppCard>
  )
}
