import { YStack, Text } from 'tamagui'
import { Bookmark } from '@tamagui/lucide-icons'
import { AppCard } from '@/components/shared'
import { CardTitle } from './CardTitle'

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
    <AppCard compact>
      <YStack gap="$2.5">
        <CardTitle icon={<Bookmark size={14} color="$placeholderColor" />}>{title}</CardTitle>
        <YStack gap="$2">
          {items.map((item) => (
            <Text key={item} fontSize={13} lineHeight={18} color="$color">
              {'\u2022'} {item}
            </Text>
          ))}
        </YStack>
      </YStack>
    </AppCard>
  )
}
