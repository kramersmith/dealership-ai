import { Platform } from 'react-native'
import { YStack, useTheme, type YStackProps } from 'tamagui'
import { palette } from '@/lib/theme/tokens'
import { HoverLiftFrame } from './HoverLiftFrame'

interface AppCardProps extends YStackProps {
  children: React.ReactNode
  /** Optional brand-colored top accent line */
  accent?: boolean
  /** Reduced padding for compact/secondary contexts */
  compact?: boolean
  /** Enable hover lift effect for interactive (tappable) cards */
  interactive?: boolean
}

export function AppCard({
  children,
  accent = false,
  compact = false,
  interactive = false,
  ...props
}: AppCardProps) {
  const theme = useTheme()
  const shadow = theme.shadowColor?.val ?? palette.overlay

  const card = (
    <YStack
      backgroundColor="$backgroundStrong"
      borderRadius={12}
      padding={compact ? '$3' : '$4'}
      borderWidth={1}
      borderColor="$borderColor"
      borderTopWidth={accent ? 2 : 1}
      borderTopColor={accent ? '$brand' : '$borderColor'}
      {...(Platform.OS === 'web'
        ? {}
        : {
            shadowColor: (shadow as string) ?? palette.overlay,
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 1,
            shadowRadius: 3,
            elevation: 2,
          })}
      {...props}
    >
      {children}
    </YStack>
  )

  if (Platform.OS === 'web') {
    return (
      <HoverLiftFrame shadowColor={shadow as string} interactive={interactive}>
        {card}
      </HoverLiftFrame>
    )
  }

  return card
}
