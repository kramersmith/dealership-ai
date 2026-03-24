import { XStack } from 'tamagui'
import { MessageSquare, DoorOpen, CircleHelp } from '@tamagui/lucide-icons'
import { colors } from '@/lib/colors'
import { AppButton } from '@/components/shared'

interface QuickActionsProps {
  onAction: (actionId: string) => void
}

const ACTIONS = [
  { id: 'what_to_say', label: 'What Do I Say?', Icon: MessageSquare },
  { id: 'should_i_walk', label: 'Should I Walk?', Icon: DoorOpen },
  { id: 'whats_missing', label: "What Am I Forgetting?", Icon: CircleHelp },
]

export function QuickActions({ onAction }: QuickActionsProps) {
  return (
    <XStack gap="$2" paddingVertical="$2" flexWrap="wrap">
      {ACTIONS.map(({ id, label, Icon }) => (
        <AppButton
          key={id}
          variant="secondary"
          size="$3"
          icon={<Icon size={14} color={colors.brand} />}
          onPress={() => onAction(id)}
        >
          {label}
        </AppButton>
      ))}
    </XStack>
  )
}
