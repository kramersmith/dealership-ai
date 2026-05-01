import { Platform } from 'react-native'
import { YStack, Text } from 'tamagui'
import { palette } from '@/lib/theme/tokens'

type AvatarSize = 'sm' | 'md' | 'lg'

const SIZE_MAP: Record<
  AvatarSize,
  { outer: number; highlight: number; letter: number; glow: number; ring: number }
> = {
  // h-7 w-7 in source for chat-row avatars
  sm: { outer: 28, highlight: 6, letter: 12, glow: 16, ring: 2 },
  md: { outer: 32, highlight: 7, letter: 14, glow: 18, ring: 2 },
  // h-9 w-9 in source for coach header avatar
  lg: { outer: 36, highlight: 8, letter: 16, glow: 20, ring: 2 },
}

export function AssistantAvatar({ size = 'sm' }: { size?: AvatarSize }) {
  const dims = SIZE_MAP[size]

  return (
    <YStack
      width={dims.outer}
      height={dims.outer}
      borderRadius={999}
      borderWidth={dims.ring}
      borderColor={palette.slate800}
      alignItems="center"
      justifyContent="center"
      flexShrink={0}
      {...(Platform.OS === 'web'
        ? {
            style: {
              background: `radial-gradient(circle at 30% 30%, #ede9fe 0%, ${palette.copilotAssistantAvatar} 55%, #7c3aed 100%)`,
              boxShadow: `0 0 ${dims.glow}px rgba(168, 85, 247, 0.45)`,
            },
          }
        : {
            backgroundColor: palette.copilotAssistantAvatar,
            shadowColor: '#a855f7',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.45,
            shadowRadius: dims.glow / 2,
            elevation: 6,
          })}
    >
      <YStack
        position="absolute"
        top={dims.outer * 0.22}
        left={dims.outer * 0.24}
        width={dims.highlight}
        height={dims.highlight}
        borderRadius={999}
        backgroundColor="rgba(255, 255, 255, 0.6)"
      />
    </YStack>
  )
}

export function UserAvatar({ initial, size = 'sm' }: { initial: string; size?: AvatarSize }) {
  const dims = SIZE_MAP[size]
  const letter = (initial || 'Y').trim().charAt(0).toUpperCase() || 'Y'

  return (
    <YStack
      width={dims.outer}
      height={dims.outer}
      borderRadius={999}
      backgroundColor={palette.copilotEmerald}
      alignItems="center"
      justifyContent="center"
      flexShrink={0}
      borderWidth={1}
      borderColor="rgba(16, 185, 129, 0.55)"
      {...(Platform.OS === 'web'
        ? {
            style: {
              boxShadow: 'inset 0 0 6px rgba(16, 185, 129, 0.45)',
            },
          }
        : {})}
    >
      <Text
        fontSize={dims.letter}
        fontWeight="800"
        color={palette.copilotBackground}
        lineHeight={dims.letter + 2}
      >
        {letter}
      </Text>
    </YStack>
  )
}
