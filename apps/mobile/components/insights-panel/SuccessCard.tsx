import { YStack } from 'tamagui'
import { CheckCircle } from '@tamagui/lucide-icons'
import { AppCard } from '@/components/shared'
import { PanelMarkdown } from './PanelMarkdown'
import { CardTitle } from './CardTitle'

interface SuccessCardProps {
  title: string
  content: Record<string, any>
}

export function SuccessCard({ title, content }: SuccessCardProps) {
  const body = (content.body as string) ?? ''

  return (
    <AppCard compact borderTopWidth={2} borderTopColor="$positive">
      <YStack gap="$2">
        <CardTitle icon={<CheckCircle size={14} color="$positive" />}>{title}</CardTitle>
        <PanelMarkdown>{body}</PanelMarkdown>
      </YStack>
    </AppCard>
  )
}
