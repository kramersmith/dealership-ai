import { XStack, YStack, Text } from 'tamagui'
import { CheckCircle } from '@tamagui/lucide-icons'
import { AppCard } from '@/components/shared'
import { PanelMarkdown } from './PanelMarkdown'

interface SuccessCardProps {
  title: string
  content: Record<string, any>
}

export function SuccessCard({ title, content }: SuccessCardProps) {
  const body = (content.body as string) ?? ''

  return (
    <AppCard compact>
      <YStack borderLeftWidth={3} borderLeftColor="$positive" paddingLeft="$3" gap="$2">
        <XStack gap="$2.5" alignItems="flex-start">
          <YStack paddingTop="$0.5">
            <CheckCircle size={15} color="$positive" />
          </YStack>
          <YStack flex={1} gap="$1.5">
            <Text fontSize={14} fontWeight="600" color="$color">
              {title}
            </Text>
            <PanelMarkdown>{body}</PanelMarkdown>
          </YStack>
        </XStack>
      </YStack>
    </AppCard>
  )
}
