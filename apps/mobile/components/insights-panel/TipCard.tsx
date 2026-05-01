import { YStack } from 'tamagui'
import { Lightbulb } from '@tamagui/lucide-icons'
import { AppCard } from '@/components/shared'
import { palette } from '@/lib/theme/tokens'
import { PanelMarkdown } from './PanelMarkdown'
import { CardTitle } from './CardTitle'

interface TipCardProps {
  title: string
  content: Record<string, any>
}

const ACCENT_PURPLE = palette.copilotPurple

export function TipCard({ title, content }: TipCardProps) {
  const body = (content.body as string) ?? ''

  return (
    <AppCard
      header={
        <CardTitle icon={<Lightbulb size={12} color={ACCENT_PURPLE} />} iconAccent={ACCENT_PURPLE}>
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
