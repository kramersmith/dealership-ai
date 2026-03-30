import { XStack, YStack, Text } from 'tamagui'
import { Lightbulb } from '@tamagui/lucide-icons'
import { AppCard } from '@/components/shared'
import { PanelMarkdown } from './PanelMarkdown'

interface TipCardProps {
  title: string
  content: Record<string, any>
}

export function TipCard({ title, content }: TipCardProps) {
  const body = (content.body as string) ?? ''

  return (
    <AppCard compact>
      <XStack gap="$2.5" alignItems="flex-start">
        <YStack paddingTop="$0.5">
          <Lightbulb size={15} color="$brand" />
        </YStack>
        <YStack flex={1} gap="$1.5">
          <Text fontSize={14} fontWeight="600" color="$color">
            {title}
          </Text>
          <PanelMarkdown>{body}</PanelMarkdown>
        </YStack>
      </XStack>
    </AppCard>
  )
}
