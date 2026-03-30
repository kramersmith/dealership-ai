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
  const borderWidth = isCritical ? 3 : 2
  const Icon = isCritical ? AlertCircle : AlertTriangle

  return (
    <AppCard compact>
      <YStack borderLeftWidth={borderWidth} borderLeftColor={accentColor} paddingLeft="$3" gap="$2">
        <XStack gap="$2.5" alignItems="flex-start">
          <YStack paddingTop="$0.5">
            <Icon size={15} color={accentColor} />
          </YStack>
          <YStack flex={1} gap="$1.5">
            <Text fontSize={14} fontWeight="600" color="$color">
              {title}
            </Text>
            <PanelMarkdown>{message}</PanelMarkdown>
          </YStack>
        </XStack>

        {action && (
          <YStack borderTopWidth={1} borderTopColor="$borderColor" paddingTop="$2" marginTop="$1">
            <Text fontSize={13} fontWeight="600" color="$color">
              {action}
            </Text>
          </YStack>
        )}
      </YStack>
    </AppCard>
  )
}
