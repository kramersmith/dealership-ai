import { Animated } from 'react-native'
import { XStack, YStack, Text, useTheme } from 'tamagui'
import { Check } from '@tamagui/lucide-icons'
import { AppCard } from '@/components/shared'
import { insightCardBodyProps, insightCardSectionLabelProps } from '@/lib/insightsPanelTypography'
import { CardTitle } from './CardTitle'
import { useAnimatedNumber } from '@/hooks/useAnimatedValue'

interface ChecklistItem {
  label: string
  done: boolean
}

interface OpenQuestionRow {
  label: string
}

interface AiChecklistCardProps {
  title: string
  content: Record<string, any>
}

/** Same outer box as checklist checkboxes so rows align visually. */
const CHECKLIST_ROW_MARKER_SIZE = 14

function OpenQuestionRow({ item }: { item: OpenQuestionRow }) {
  return (
    <XStack gap="$2.5" alignItems="center" paddingVertical="$1.5">
      <XStack
        width={CHECKLIST_ROW_MARKER_SIZE}
        height={CHECKLIST_ROW_MARKER_SIZE}
        borderRadius={CHECKLIST_ROW_MARKER_SIZE / 2}
        borderWidth={2}
        borderColor="$borderColor"
        backgroundColor="transparent"
        alignItems="center"
        justifyContent="center"
        flexShrink={0}
      />
      <Text flex={1} {...insightCardBodyProps}>
        {item.label}
      </Text>
    </XStack>
  )
}

function ChecklistRow({ item }: { item: ChecklistItem }) {
  return (
    <XStack gap="$2.5" alignItems="center" paddingVertical="$1.5">
      <XStack
        width={CHECKLIST_ROW_MARKER_SIZE}
        height={CHECKLIST_ROW_MARKER_SIZE}
        borderRadius={CHECKLIST_ROW_MARKER_SIZE / 2}
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
  const items: ChecklistItem[] = Array.isArray(content.items)
    ? (content.items as ChecklistItem[])
    : []
  const openQuestions: OpenQuestionRow[] = Array.isArray(content.open_questions)
    ? (content.open_questions as OpenQuestionRow[])
    : []

  if (items.length === 0 && openQuestions.length === 0) return null

  const doneCount = items.filter((item) => item.done).length
  const stepProgress = items.length > 0 ? doneCount / items.length : 0
  const showBothSections = openQuestions.length > 0 && items.length > 0

  return (
    <AppCard compact>
      <YStack gap="$3">
        <CardTitle>{title}</CardTitle>
        {openQuestions.length > 0 ? (
          <YStack gap="$1.5">
            <Text {...insightCardSectionLabelProps}>Still confirming</Text>
            <YStack gap="$0.5">
              {openQuestions.map((item, index) => (
                <OpenQuestionRow key={`oq-${index}`} item={item} />
              ))}
            </YStack>
          </YStack>
        ) : null}
        {items.length > 0 ? (
          <YStack gap="$1.5">
            {showBothSections ? <Text {...insightCardSectionLabelProps}>Your steps</Text> : null}
            <AnimatedProgressBar progress={stepProgress} />
            <YStack gap="$0.5">
              {items.map((item, index) => (
                <ChecklistRow key={`it-${index}`} item={item} />
              ))}
            </YStack>
          </YStack>
        ) : null}
      </YStack>
    </AppCard>
  )
}
