import { XStack, YStack, Text } from 'tamagui'
import { Bookmark } from '@tamagui/lucide-icons'
import { AppCard } from '@/components/shared'
import { insightCardBodyProps } from '@/lib/insightsPanelTypography'
import { palette } from '@/lib/theme/tokens'
import { CardTitle } from './CardTitle'

const ACCENT_SLATE = palette.slate400

interface NotesItem {
  text?: string
}

interface NotesCardProps {
  title: string
  content: Record<string, any>
}

function normalizeItems(content: Record<string, any>): string[] {
  const rawItems = (content.items as Array<string | NotesItem>) ?? []
  return rawItems
    .map((item) => (typeof item === 'string' ? item : (item.text ?? '')))
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5)
}

export function NotesCard({ title, content }: NotesCardProps) {
  const items = normalizeItems(content)

  if (items.length === 0) return null

  return (
    <AppCard
      header={
        <CardTitle icon={<Bookmark size={12} color={ACCENT_SLATE} />} iconAccent={ACCENT_SLATE}>
          {title}
        </CardTitle>
      }
    >
      <YStack gap="$2.5">
        {items.map((item, index) => (
          <XStack key={`${item}-${index}`} alignItems="flex-start" gap="$2">
            <Text {...insightCardBodyProps}>{'•'}</Text>
            <Text flex={1} {...insightCardBodyProps}>
              {item}
            </Text>
          </XStack>
        ))}
      </YStack>
    </AppCard>
  )
}
