import { YStack, Text } from 'tamagui'
import type { AiCardPriority } from '@/lib/types'
import { AppCard } from '@/components/shared'
import { PanelMarkdown } from './PanelMarkdown'

interface BriefingCardProps {
  title: string
  content: Record<string, any>
  priority: AiCardPriority
}

export function BriefingCard({ title, content, priority }: BriefingCardProps) {
  const body = (content.body as string) ?? ''
  const showAccent = priority === 'critical' || priority === 'high'

  return (
    <AppCard compact>
      <YStack
        borderLeftWidth={showAccent ? 3 : 0}
        borderLeftColor={showAccent ? '$brand' : undefined}
        paddingLeft={showAccent ? '$3' : undefined}
        gap="$2"
      >
        <Text fontSize={14} fontWeight="600" color="$color">
          {title}
        </Text>
        <PanelMarkdown>{body}</PanelMarkdown>
      </YStack>
    </AppCard>
  )
}
