import { YStack } from 'tamagui'
import { CheckCircle } from '@tamagui/lucide-icons'
import { AppCard } from '@/components/shared'
import { palette } from '@/lib/theme/tokens'
import { PanelMarkdown } from './PanelMarkdown'
import { CardTitle } from './CardTitle'

interface SuccessCardProps {
  title: string
  content: Record<string, any>
}

export function SuccessCard({ title, content }: SuccessCardProps) {
  const body = (content.body as string) ?? ''
  const accent = palette.copilotEmerald

  return (
    <AppCard
      header={
        <CardTitle icon={<CheckCircle size={12} color={accent} />} iconAccent={accent}>
          {title}
        </CardTitle>
      }
    >
      <YStack>
        <PanelMarkdown>{body}</PanelMarkdown>
      </YStack>
    </AppCard>
  )
}
