import { XStack, YStack, Text } from 'tamagui'
import { AlertTriangle, AlertCircle } from '@tamagui/lucide-icons'
import type { AiCardPriority } from '@/lib/types'
import { AppCard } from '@/components/shared'
import { PanelMarkdown } from './PanelMarkdown'

interface WarningCardProps {
  title: string
  content: Record<string, any>
  priority: AiCardPriority
}

export function WarningCard({ title, content, priority }: WarningCardProps) {
  const severity = (content.severity as 'critical' | 'warning') ?? 'warning'
  const message = (content.message as string) ?? ''
  const action = content.action as string | undefined

  const isCritical = severity === 'critical' || priority === 'critical'
  const accentColor = isCritical ? '$danger' : '$warning'
  const Icon = isCritical ? AlertCircle : AlertTriangle

  return (
    <AppCard compact borderTopWidth={2} borderTopColor={accentColor}>
      <YStack gap="$3">
        {/* Title row */}
        <XStack gap="$2" alignItems="center">
          <Icon size={16} color={accentColor} />
          <Text fontSize={14} fontWeight="700" color={accentColor} flex={1}>
            {title}
          </Text>
        </XStack>

        {/* Description */}
        <PanelMarkdown>{message}</PanelMarkdown>

        {/* Recommended action */}
        {action && (
          <XStack
            backgroundColor="$backgroundHover"
            borderRadius={8}
            borderLeftWidth={2}
            borderLeftColor={accentColor}
            paddingVertical="$2"
            paddingLeft="$2.5"
            paddingRight="$3"
          >
            <Text fontSize={13} fontWeight="500" color="$placeholderColor" flex={1} lineHeight={20}>
              {action}
            </Text>
          </XStack>
        )}
      </YStack>
    </AppCard>
  )
}
