import { Animated } from 'react-native'
import { XStack, YStack, Text, useTheme } from 'tamagui'
import { Check } from '@tamagui/lucide-icons'
import { AppCard } from '@/components/shared'
import { insightCardBodyProps } from '@/lib/insightsPanelTypography'
import { CardTitle } from './CardTitle'
import { useAnimatedNumber } from '@/hooks/useAnimatedValue'

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
        width={14}
        height={14}
        borderRadius={7}
        borderWidth={2}
        borderColor={item.done ? '$positive' : '$borderColor'}
        backgroundColor={item.done ? '$positive' : 'transparent'}
        alignItems="center"
        justifyContent="center"
      >
        {item.done && <Check size={8} color="$white" strokeWidth={2.5} />}
      </XStack>
      <Text
        flex={1}
        {...insightCardBodyProps}
        color={item.done ? '$placeholderColor' : '$color'}
        textDecorationLine={item.done ? 'line-through' : 'none'}
      >
        {item.label}
      </Text>
    </XStack>
  )
}

function AnimatedProgressBar({ progress }: { progress: number }) {
  const theme = useTheme()
  const animatedProgress = useAnimatedNumber(progress, 400)
  const widthPercent = animatedProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  })

  return (
    <XStack height={3} borderRadius={2} backgroundColor="$borderColor">
      <Animated.View
        style={{
          height: 3,
          borderRadius: 2,
          backgroundColor:
            progress === 1 ? (theme.positive?.val as string) : (theme.brand?.val as string),
          width: widthPercent,
        }}
      />
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
          <AnimatedProgressBar progress={progress} />
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
