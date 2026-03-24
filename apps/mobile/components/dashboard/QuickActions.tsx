import { XStack } from 'tamagui'
import { MessageSquare, DoorOpen, CircleHelp, Search } from '@tamagui/lucide-icons'
import { colors } from '@/lib/colors'
import { AppButton } from '@/components/shared'
import { DEFAULT_BUYER_CONTEXT } from '@/lib/constants'
import type { BuyerContext } from '@/lib/types'

interface QuickAction {
  id: string
  label: string
  Icon: typeof MessageSquare
}

const ACTIONS_BY_CONTEXT: Record<BuyerContext, QuickAction[]> = {
  researching: [
    { id: 'compare_prices', label: 'Compare Prices', Icon: Search },
    { id: 'new_or_used', label: 'New or Used?', Icon: CircleHelp },
    { id: 'whats_my_budget', label: "What's My Budget?", Icon: CircleHelp },
  ],
  reviewing_deal: [
    { id: 'check_price', label: 'Check This Price', Icon: Search },
    { id: 'hidden_fees', label: 'Hidden Fees?', Icon: CircleHelp },
    { id: 'should_i_walk', label: 'Should I Walk?', Icon: DoorOpen },
  ],
  at_dealership: [
    { id: 'what_to_say', label: 'What Do I Say?', Icon: MessageSquare },
    { id: 'should_i_walk', label: 'Should I Walk?', Icon: DoorOpen },
    { id: 'pressuring_me', label: "They're Pressuring Me", Icon: CircleHelp },
  ],
}

interface QuickActionsProps {
  buyerContext: BuyerContext
  onAction: (actionId: string) => void
}

export function QuickActions({ buyerContext, onAction }: QuickActionsProps) {
  const actions = ACTIONS_BY_CONTEXT[buyerContext] ?? ACTIONS_BY_CONTEXT[DEFAULT_BUYER_CONTEXT]

  return (
    <XStack gap="$2" paddingVertical="$2" flexWrap="wrap">
      {actions.map(({ id, label, Icon }) => (
        <AppButton
          key={id}
          variant="secondary"
          size="$3"
          minHeight={44}
          icon={<Icon size={14} color={colors.brand} />}
          onPress={() => onAction(id)}
        >
          {label}
        </AppButton>
      ))}
    </XStack>
  )
}
