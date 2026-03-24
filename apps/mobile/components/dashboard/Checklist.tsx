import { XStack, YStack, Text } from 'tamagui'
import { TouchableOpacity } from 'react-native'
import type { ChecklistItem } from '@/lib/types'
import { colors } from '@/lib/colors'
import { AppCard, SectionHeader } from '@/components/shared'

interface ChecklistProps {
  items: ChecklistItem[]
  onToggle: (index: number) => void
}

export function Checklist({ items, onToggle }: ChecklistProps) {
  if (items.length === 0) {
    return (
      <AppCard>
        <Text fontSize={13} color="$placeholderColor" textAlign="center">
          No checklist items yet. Start chatting to build your checklist.
        </Text>
      </AppCard>
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
          <TouchableOpacity
            key={index}
            onPress={() => onToggle(index)}
            activeOpacity={0.7}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
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
          </TouchableOpacity>
        ))}
      </YStack>
    </AppCard>
  )
}
