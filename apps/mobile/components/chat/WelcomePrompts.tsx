import { TouchableOpacity, Animated } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { Search, FileText, MapPin } from '@tamagui/lucide-icons'
import type { BuyerContext } from '@/lib/types'
import { useFadeIn } from '@/hooks/useAnimatedValue'

interface WelcomePromptsProps {
  onSelect: (context: BuyerContext) => void
}

const CONTEXT_OPTIONS: {
  context: BuyerContext
  label: string
  subtitle: string
  Icon: typeof Search
}[] = [
  {
    context: 'researching',
    label: 'Researching',
    subtitle: 'Looking at cars, comparing prices',
    Icon: Search,
  },
  {
    context: 'reviewing_deal',
    label: 'Have a deal to review',
    subtitle: 'Got a quote or offer I want to check',
    Icon: FileText,
  },
  {
    context: 'at_dealership',
    label: 'At the dealership',
    subtitle: "I'm here right now and need help",
    Icon: MapPin,
  },
]

export function WelcomePrompts({ onSelect }: WelcomePromptsProps) {
  const opacity = useFadeIn(400)

  return (
    <Animated.View style={{ opacity }}>
      <YStack
        flex={1}
        justifyContent="center"
        padding="$4"
        gap="$4"
        maxWidth={480}
        alignSelf="center"
        width="100%"
      >
        <YStack gap="$2" alignItems="center">
          <Text fontSize={20} fontWeight="700" color="$color" textAlign="center">
            How can I help?
          </Text>
          <Text fontSize={14} color="$placeholderColor" textAlign="center">
            Select where you are in the process, or just start typing below.
          </Text>
        </YStack>

        <YStack gap="$3">
          {CONTEXT_OPTIONS.map(({ context, label, subtitle, Icon }) => (
            <TouchableOpacity key={context} onPress={() => onSelect(context)} activeOpacity={0.7}>
              <XStack
                backgroundColor="$backgroundStrong"
                borderRadius="$3"
                padding="$4"
                borderWidth={1}
                borderColor="$borderColor"
                alignItems="center"
                gap="$3"
                minHeight={64}
              >
                <YStack
                  width={40}
                  height={40}
                  borderRadius="$2"
                  backgroundColor="$brandSubtle"
                  alignItems="center"
                  justifyContent="center"
                >
                  <Icon size={20} color="$brand" />
                </YStack>
                <YStack flex={1} gap="$1">
                  <Text fontSize={15} fontWeight="600" color="$color">
                    {label}
                  </Text>
                  <Text fontSize={13} color="$placeholderColor">
                    {subtitle}
                  </Text>
                </YStack>
              </XStack>
            </TouchableOpacity>
          ))}
        </YStack>
      </YStack>
    </Animated.View>
  )
}
