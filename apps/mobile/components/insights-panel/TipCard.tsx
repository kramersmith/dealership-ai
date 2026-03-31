import { YStack } from 'tamagui'
import { Lightbulb } from '@tamagui/lucide-icons'
import { AppCard } from '@/components/shared'
import { PanelMarkdown } from './PanelMarkdown'
import { CardTitle } from './CardTitle'

interface TipCardProps {
  title: string
  content: Record<string, any>
}

export function TipCard({ title, content }: TipCardProps) {
  const body = (content.body as string) ?? ''

  return (
    <AppCard compact>
      <YStack gap="$2">
        <CardTitle icon={<Lightbulb size={14} color="$brand" />}>{title}</CardTitle>
        <PanelMarkdown>{body}</PanelMarkdown>
      </YStack>
    </AppCard>
  )
}
