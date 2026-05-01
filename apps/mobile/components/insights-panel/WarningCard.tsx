import { XStack, YStack, Text } from 'tamagui'
import { AlertTriangle, AlertCircle } from '@tamagui/lucide-icons'
import type { AiCardPriority } from '@/lib/types'
import { AppCard } from '@/components/shared'
import { insightCardBodyProps } from '@/lib/insightsPanelTypography'
import { palette } from '@/lib/theme/tokens'
import { PanelMarkdown } from './PanelMarkdown'
import { CardTitle } from './CardTitle'

interface WarningCardProps {
  title: string
  content: Record<string, any>
  priority: AiCardPriority
}

const ACCENT_WARNING = palette.copilotWarning
const ACCENT_DANGER = palette.danger

export function WarningCard({ title, content, priority }: WarningCardProps) {
  const severity = (content.severity as 'critical' | 'warning') ?? 'warning'
  const message = (content.message as string) ?? ''
  const action = content.action as string | undefined

  const isCritical = severity === 'critical' || priority === 'critical'
  const accent = isCritical ? ACCENT_DANGER : ACCENT_WARNING
  const Icon = isCritical ? AlertCircle : AlertTriangle

  return (
    <AppCard
      header={
        <CardTitle icon={<Icon size={12} color={accent} />} iconAccent={accent}>
          {title}
        </CardTitle>
      }
    >
      <YStack gap="$3">
        <PanelMarkdown>{message}</PanelMarkdown>
        {action && (
          <XStack
            backgroundColor={palette.ghostBg}
            borderRadius={8}
            borderLeftWidth={2}
            borderLeftColor={accent}
            paddingVertical={8}
            paddingLeft={10}
            paddingRight={12}
          >
            <Text {...insightCardBodyProps} fontWeight="500" color={palette.slate400} flex={1}>
              {action}
            </Text>
          </XStack>
        )}
      </YStack>
    </AppCard>
  )
}
