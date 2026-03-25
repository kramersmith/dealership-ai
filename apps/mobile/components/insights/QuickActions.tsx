import { useEffect, useMemo, useRef } from 'react'
import { Animated } from 'react-native'
import { XStack } from 'tamagui'
import { AppButton } from '@/components/shared'
import type { QuickAction } from '@/lib/types'
import { USE_NATIVE_DRIVER } from '@/lib/platform'

interface QuickActionsProps {
  actions: QuickAction[]
  onAction: (prompt: string) => void
  disabled?: boolean
}

export function QuickActions({ actions, onAction, disabled }: QuickActionsProps) {
  const opacity = useRef(new Animated.Value(0)).current

  // Stable key so the fade-in only re-triggers when action labels actually change
  const actionsKey = useMemo(() => actions.map((action) => action.label).join('|'), [actions])

  useEffect(() => {
    if (actions.length > 0) {
      opacity.setValue(0)
      Animated.timing(opacity, {
        toValue: 1,
        duration: 250,
        useNativeDriver: USE_NATIVE_DRIVER,
      }).start()
    }
  }, [actionsKey])

  if (actions.length === 0) return null

  return (
    <Animated.View style={{ opacity }}>
      <XStack gap="$2" paddingTop="$1" paddingBottom="$2" flexWrap="wrap">
        {actions.map((action) => (
          <AppButton
            key={action.label}
            variant="secondary"
            size="$3"
            minHeight={44}
            backgroundColor="$backgroundStrong"
            borderWidth={0}
            borderColor="transparent"
            borderRadius="$3"
            pressStyle={{ backgroundColor: '$backgroundHover' }}
            onPress={() => onAction(action.prompt)}
            disabled={disabled}
            opacity={disabled ? 0.5 : 1}
          >
            {action.label}
          </AppButton>
        ))}
      </XStack>
    </Animated.View>
  )
}
