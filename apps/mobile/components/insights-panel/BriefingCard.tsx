import { YStack } from 'tamagui'
import { BarChart3, Eye, RefreshCw, Sparkles } from '@tamagui/lucide-icons'
import type { AiCardKind, AiCardPriority } from '@/lib/types'
import { AppCard } from '@/components/shared'
import { palette } from '@/lib/theme/tokens'
import { PanelMarkdown } from './PanelMarkdown'
import { CardTitle } from './CardTitle'

interface BriefingCardProps {
  title: string
  content: Record<string, any>
  priority: AiCardPriority
  kind?: AiCardKind
}

const ACCENT_PURPLE = palette.copilotPurple
const ACCENT_BLUE = '#60a5fa'
const ACCENT_SLATE = palette.slate400
const ACCENT_EMERALD = palette.copilotEmerald
const ACCENT_WARNING = palette.copilotWarning

function pickIcon(
  kind: AiCardKind | undefined,
  priority: AiCardPriority
): { Icon: typeof Sparkles; accent: string } {
  switch (kind) {
    case 'next_best_move':
      return { Icon: Sparkles, accent: ACCENT_PURPLE }
    case 'dealer_read':
      return { Icon: Eye, accent: ACCENT_BLUE }
    case 'what_changed':
      return { Icon: RefreshCw, accent: ACCENT_SLATE }
    default:
      // Status / phase briefing: escalate to amber when high/critical so the
      // user sees a visual cue that the situation needs attention without
      // jumping straight to red.
      return {
        Icon: BarChart3,
        accent: priority === 'high' || priority === 'critical' ? ACCENT_WARNING : ACCENT_EMERALD,
      }
  }
}

export function BriefingCard({ title, content, priority, kind }: BriefingCardProps) {
  const body = (content.body as string) ?? ''
  const { Icon, accent } = pickIcon(kind, priority)

  return (
    <AppCard
      header={
        <CardTitle icon={<Icon size={12} color={accent} />} iconAccent={accent}>
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
