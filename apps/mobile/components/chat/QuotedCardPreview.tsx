import { YStack, Text } from 'tamagui'
import type { QuotedCard } from '@/lib/types'

interface QuotedCardPreviewProps {
  card: QuotedCard
}

/** Extract a compact 2-3 line summary based on card type. */
function getSummaryLines(card: QuotedCard): string[] {
  const cardContent = card.content
  switch (card.type) {
    case 'numbers': {
      const groups = (cardContent.groups as any[]) ?? []
      const rows = (cardContent.rows as any[]) ?? []
      const allRows = groups.length > 0 ? groups.flatMap((group: any) => group.rows ?? []) : rows
      return allRows.slice(0, 3).map((row: any) => `${row.label}  ${row.value ?? '—'}`)
    }
    case 'warning':
      return [
        cardContent.message ? String(cardContent.message).split('\n')[0].slice(0, 80) : '',
      ].filter(Boolean)
    case 'vehicle': {
      const vehicle = cardContent.vehicle as any
      if (!vehicle) return []
      const summary = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
        .filter(Boolean)
        .join(' ')
      return [summary].filter(Boolean)
    }
    case 'briefing':
    case 'tip':
    case 'success': {
      const text = cardContent.message ?? cardContent.body ?? cardContent.summary ?? ''
      if (!text) return []
      const first = String(text).split(/[.\n]/)[0].slice(0, 100)
      return [first].filter(Boolean)
    }
    case 'comparison': {
      const items = (cardContent.items as any[]) ?? []
      return items.slice(0, 2).map((item: any) => item.label ?? item.name ?? '')
    }
    case 'checklist': {
      const items = (cardContent.items as any[]) ?? []
      return items
        .slice(0, 2)
        .map(
          (item: any) => `${item.checked ? '\u2713' : '\u2022'} ${item.label ?? item.text ?? ''}`
        )
    }
    default:
      return []
  }
}

/** Compact quoted card preview for user chat bubbles — small, muted, non-interactive. */
export function QuotedCardPreview({ card }: QuotedCardPreviewProps) {
  const lines = getSummaryLines(card)

  return (
    <YStack
      backgroundColor="rgba(255,255,255,0.08)"
      borderRadius="$2"
      padding="$2"
      marginBottom="$2"
    >
      <Text
        fontSize={10}
        fontWeight="600"
        color="white"
        opacity={0.5}
        textTransform="uppercase"
        letterSpacing={0.5}
      >
        {card.title}
      </Text>
      {lines.map((line, i) => (
        <Text key={i} fontSize={11} color="white" opacity={0.6} numberOfLines={1}>
          {line}
        </Text>
      ))}
    </YStack>
  )
}
