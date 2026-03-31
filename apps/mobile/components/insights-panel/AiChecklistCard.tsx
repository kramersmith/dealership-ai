import { XStack, YStack, Text } from 'tamagui'
import { Check } from '@tamagui/lucide-icons'
import { AppCard } from '@/components/shared'
import { CardTitle } from './CardTitle'

interface ChecklistItem {
  label: string
  done: boolean
}

interface AiChecklistCardProps {
  title: string
  content: Record<string, any>
}

function ChecklistRow({ item }: { item: ChecklistItem }) {
  return (
    <XStack gap="$2.5" alignItems="center" paddingVertical="$1.5">
      <XStack
        width={18}
        height={18}
        borderRadius={9}
        borderWidth={2}
        borderColor={item.done ? '$positive' : '$borderColor'}
        backgroundColor={item.done ? '$positive' : 'transparent'}
        alignItems="center"
        justifyContent="center"
      >
        {item.done && <Check size={10} color="$white" strokeWidth={3} />}
      </XStack>
      <Text
        flex={1}
        fontSize={12}
        lineHeight={16}
        color={item.done ? '$placeholderColor' : '$color'}
        textDecorationLine={item.done ? 'line-through' : 'none'}
      >
        {item.label}
      </Text>
    </XStack>
  )
}

export function AiChecklistCard({ title, content }: AiChecklistCardProps) {
  const items = (content.items as ChecklistItem[]) ?? []

  if (items.length === 0) return null

  const doneCount = items.filter((item) => item.done).length
  const progress = doneCount / items.length

  return (
    <AppCard compact>
      <YStack gap="$3">
        <YStack gap="$1.5">
          <CardTitle>{title}</CardTitle>
          <XStack height={3} borderRadius={2} backgroundColor="$borderColor">
            <XStack
              height={3}
              borderRadius={2}
              backgroundColor={progress === 1 ? '$positive' : '$brand'}
              width={`${progress * 100}%` as any}
            />
          </XStack>
        </YStack>
        <YStack gap="$0.5">
          {items.map((item, index) => (
            <ChecklistRow key={index} item={item} />
          ))}
        </YStack>
      </YStack>
    </AppCard>
  )
}
