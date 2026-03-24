import { useRef, useEffect } from 'react'
import { Animated, TouchableOpacity, Platform } from 'react-native'
import { XStack, YStack, Text } from 'tamagui'

const useNative = Platform.OS !== 'web'
import type { ChecklistItem } from '@/lib/types'
import { colors } from '@/lib/colors'
import { AppCard, SectionHeader } from '@/components/shared'
import { useFadeIn } from '@/hooks/useAnimatedValue'

interface ChecklistProps {
  items: ChecklistItem[]
  onToggle: (index: number) => void
}

function ChecklistRow({ item, index, onToggle }: { item: ChecklistItem; index: number; onToggle: (i: number) => void }) {
  const scale = useRef(new Animated.Value(1)).current

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.95, duration: 80, useNativeDriver: useNative }),
      Animated.timing(scale, { toValue: 1, duration: 80, useNativeDriver: useNative }),
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
            borderColor={item.done ? colors.brand : '$placeholderColor'}
            backgroundColor={item.done ? colors.brand : 'transparent'}
            alignItems="center"
            justifyContent="center"
          >
            {item.done && (
              <Text color="white" fontSize={14} fontWeight="700" marginTop={-1}>
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
  const opacity = useFadeIn(400)

  if (items.length === 0) {
    return (
      <Animated.View style={{ opacity }}>
        <AppCard>
          <Text fontSize={13} color="$placeholderColor" textAlign="center">
            No checklist items yet. Start chatting to build your checklist.
          </Text>
        </AppCard>
      </Animated.View>
    )
  }

  const doneCount = items.filter((i) => i.done).length

  return (
    <AppCard gap="$2">
      <SectionHeader
        title="Checklist"
        action={`${doneCount}/${items.length}`}
      />
      <YStack gap="$1">
        {items.map((item, index) => (
          <ChecklistRow key={index} item={item} index={index} onToggle={onToggle} />
        ))}
      </YStack>
    </AppCard>
  )
}
