import { YStack, Text } from 'tamagui'
import type { QuotedCard } from '@/lib/types'

interface QuotedCardPreviewProps {
  card: QuotedCard
}

/** Extract a compact 2-3 line summary based on card type. */
function getSummaryLines(card: QuotedCard): string[] {
  const cardContent = card.content
  switch (card.kind) {
    case 'numbers':
    case 'what_changed': {
      const groups = (cardContent.groups as any[]) ?? []
      const rows = (cardContent.rows as any[]) ?? []
      const allRows = groups.length > 0 ? groups.flatMap((group: any) => group.rows ?? []) : rows
      return allRows.slice(0, 3).map((row: any) => `${row.label}  ${row.value ?? '—'}`)
    }
    case 'warning':
    case 'if_you_say_yes':
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
    case 'dealer_read':
    case 'your_leverage':
    case 'next_best_move':
    case 'success':
    case 'savings_so_far': {
      const text =
        cardContent.message ?? cardContent.body ?? cardContent.headline ?? cardContent.summary ?? ''
      if (!text) return []
      const first = String(text).split(/[.\n]/)[0].slice(0, 100)
      return [first].filter(Boolean)
    }
    case 'notes': {
      const items = (cardContent.items as Array<string | { text?: string }>) ?? []
      return items
        .slice(0, 3)
        .map((item) => (typeof item === 'string' ? item : (item.text ?? '')))
        .filter(Boolean)
    }
    case 'comparison':
    case 'trade_off': {
      const highlights = (cardContent.highlights as any[]) ?? []
      return highlights.slice(0, 2).map((item: any) => item.label ?? item.name ?? '')
    }
    // Historical: `what_still_needs_confirming` (pre-merge) was a checklist-templated card
    // with `items`. Older persisted QuotedCard payloads may still carry that kind string.
    case 'what_still_needs_confirming' as any:
    case 'checklist': {
      const openQ: any[] = Array.isArray(cardContent.open_questions)
        ? (cardContent.open_questions as any[])
        : []
      const items: any[] = Array.isArray(cardContent.items) ? (cardContent.items as any[]) : []
      const lines: string[] = []
      for (const item of openQ.slice(0, 2)) {
        const label = item?.label ?? item?.text ?? ''
        if (label) lines.push(`\u25CB ${label}`)
      }
      for (const item of items.slice(0, Math.max(0, 2 - lines.length))) {
        const label = item?.label ?? item?.text ?? ''
        if (label) lines.push(`${item.done ? '\u2713' : '\u2022'} ${label}`)
      }
      return lines
    }
    default:
      return []
  }
}

/** Compact quoted card preview for user chat bubbles — small, muted, non-interactive. */
export function QuotedCardPreview({ card }: QuotedCardPreviewProps) {
  const lines = getSummaryLines(card)

  return (
    <YStack backgroundColor="$brandPressed" borderRadius="$2" padding="$2" marginBottom="$2">
      <Text
        fontSize={10}
        fontWeight="600"
        color="$white"
        opacity={0.5}
        textTransform="uppercase"
        letterSpacing={0.5}
      >
        {card.title}
      </Text>
      {lines.map((line, i) => (
        <Text key={i} fontSize={11} color="$white" opacity={0.6} numberOfLines={1}>
          {line}
        </Text>
      ))}
    </YStack>
  )
}
