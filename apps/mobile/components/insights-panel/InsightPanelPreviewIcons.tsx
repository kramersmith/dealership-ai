import { XStack, Text, useTheme } from 'tamagui'
import {
  AlertTriangle,
  BarChart3,
  Bookmark,
  Car,
  CheckCircle,
  Compass,
  Handshake,
  HelpCircle,
  ListChecks,
  PiggyBank,
  Scale,
  Sparkles,
  Target,
  TrendingUp,
} from '@tamagui/lucide-icons'
import type { AiCardKind } from '@/lib/types'

export const MAX_PANEL_PREVIEW_ICONS = 4

const PANEL_KIND_ICONS: Partial<Record<AiCardKind, typeof Sparkles>> = {
  phase: Compass,
  vehicle: Car,
  numbers: BarChart3,
  warning: AlertTriangle,
  notes: Bookmark,
  checklist: ListChecks,
  success: CheckCircle,
  what_changed: TrendingUp,
  what_still_needs_confirming: HelpCircle,
  dealer_read: Bookmark,
  your_leverage: Scale,
  next_best_move: Target,
  if_you_say_yes: Handshake,
  savings_so_far: PiggyBank,
}

/** Short labels for screen readers (panel breadth, not full card titles). */
const PANEL_KIND_A11Y: Partial<Record<AiCardKind, string>> = {
  phase: 'status and situation',
  vehicle: 'vehicle details',
  numbers: 'deal numbers',
  warning: 'warnings',
  notes: 'notes',
  checklist: 'checklist',
  success: 'positive signals',
  what_changed: 'what changed',
  what_still_needs_confirming: 'items to confirm',
  dealer_read: 'dealer read',
  your_leverage: 'leverage',
  next_best_move: 'next move',
  if_you_say_yes: 'if you say yes',
  savings_so_far: 'savings',
}

export function describePanelIconKindsForA11y(kinds: readonly AiCardKind[]): string {
  if (kinds.length === 0) return ''
  const parts = kinds.map((k) => PANEL_KIND_A11Y[k] ?? `${String(k).replace(/_/g, ' ')}`)
  return parts.join(', ')
}

function IconForKind({ kind, color }: { kind: AiCardKind; color: string }) {
  const Icon = PANEL_KIND_ICONS[kind] ?? Sparkles
  return <Icon size={14} color={color} />
}

export function InsightPanelPreviewIcons({
  kinds,
  maxIcons = MAX_PANEL_PREVIEW_ICONS,
}: {
  kinds: readonly AiCardKind[]
  maxIcons?: number
}) {
  const theme = useTheme()
  const color = (theme.placeholderColor?.val as string) ?? '#888'

  if (kinds.length === 0) return null

  const shown = kinds.slice(0, maxIcons)
  const overflow = kinds.length - shown.length

  return (
    <XStack alignItems="center" gap="$1" flexShrink={0}>
      {shown.map((kind) => (
        <XStack key={kind} alignItems="center" justifyContent="center" opacity={0.92}>
          <IconForKind kind={kind} color={color} />
        </XStack>
      ))}
      {overflow > 0 ? (
        <Text fontSize={10} fontWeight="700" color="$placeholderColor">
          +{overflow}
        </Text>
      ) : null}
    </XStack>
  )
}
