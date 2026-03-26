import { TouchableOpacity, Animated } from 'react-native'
import { YStack, XStack, Text, Theme } from 'tamagui'
import { AlertTriangle, AlertCircle, X } from '@tamagui/lucide-icons'
import type { RedFlag } from '@/lib/types'
import { useSlideIn } from '@/hooks/useAnimatedValue'

interface RedFlagsCardProps {
  flags: RedFlag[]
  dismissedIds: Set<string>
  onDismiss: (id: string) => void
}

function FlagRow({ flag, onDismiss }: { flag: RedFlag; onDismiss: () => void }) {
  const { opacity, translateY } = useSlideIn(250)
  const isCritical = flag.severity === 'critical'
  const Icon = isCritical ? AlertCircle : AlertTriangle

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <Theme name={isCritical ? 'danger' : 'warning'}>
        <XStack
          backgroundColor="$background"
          borderRadius={10}
          paddingHorizontal="$3.5"
          paddingVertical="$3"
          gap="$2.5"
          alignItems="flex-start"
          borderWidth={1}
          borderColor="$borderColor"
        >
          <YStack paddingTop="$0.5">
            <Icon size={16} color="$color" />
          </YStack>
          <Text fontSize={13} color="$color" flex={1} lineHeight={20}>
            {flag.message}
          </Text>
          <TouchableOpacity
            onPress={onDismiss}
            activeOpacity={0.6}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={14} color="$color" opacity={0.5} />
          </TouchableOpacity>
        </XStack>
      </Theme>
    </Animated.View>
  )
}

export function RedFlagsCard({ flags, dismissedIds, onDismiss }: RedFlagsCardProps) {
  const visibleFlags = flags
    .filter((f) => !dismissedIds.has(f.id))
    .sort((a, b) => {
      if (a.severity === 'critical' && b.severity !== 'critical') return -1
      if (a.severity !== 'critical' && b.severity === 'critical') return 1
      return 0
    })

  if (visibleFlags.length === 0) return null

  return (
    <YStack gap="$2">
      <Text
        fontSize={12}
        fontWeight="600"
        color="$placeholderColor"
        textTransform="uppercase"
        letterSpacing={0.5}
        paddingHorizontal="$1"
      >
        Concerns
      </Text>
      {visibleFlags.map((flag) => (
        <FlagRow key={flag.id} flag={flag} onDismiss={() => onDismiss(flag.id)} />
      ))}
    </YStack>
  )
}
