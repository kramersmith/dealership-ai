import { YStack } from 'tamagui'
import type { AiCardPriority } from '@/lib/types'
import { AppCard } from '@/components/shared'
import { PanelMarkdown } from './PanelMarkdown'
import { CardTitle } from './CardTitle'

interface BriefingCardProps {
  title: string
  content: Record<string, any>
  priority: AiCardPriority
}

export function BriefingCard({ title, content, priority }: BriefingCardProps) {
  const body = (content.body as string) ?? ''
  const showAccent = priority === 'critical' || priority === 'high'

  return (
    <AppCard
      compact
      borderTopWidth={showAccent ? 2 : 1}
      borderTopColor={showAccent ? '$brand' : '$borderColor'}
    >
      <YStack gap="$2">
        <CardTitle>{title}</CardTitle>
        <PanelMarkdown>{body}</PanelMarkdown>
      </YStack>
    </AppCard>
  )
}
