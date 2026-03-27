import { Platform } from 'react-native'
import { YStack, useTheme, type YStackProps } from 'tamagui'
import { palette } from '@/lib/theme/tokens'

interface AppCardProps extends YStackProps {
  children: React.ReactNode
  /** Optional brand-colored top accent line */
  accent?: boolean
  /** Reduced padding for compact/secondary contexts */
  compact?: boolean
}

export function AppCard({ children, accent = false, compact = false, ...props }: AppCardProps) {
  const theme = useTheme()

  return (
    <YStack
      backgroundColor="$backgroundStrong"
      borderRadius={12}
      padding={compact ? '$3' : '$4'}
      borderWidth={1}
      borderColor="$borderColor"
      borderTopWidth={accent ? 2 : 1}
      borderTopColor={accent ? '$brand' : '$borderColor'}
      {...(Platform.OS === 'web'
        ? {
            style: {
              boxShadow: `0 1px 3px ${theme.shadowColor?.val ?? palette.overlay}, 0 1px 2px ${theme.shadowColor?.val ?? palette.overlay}`,
            },
          }
        : {
            shadowColor: (theme.shadowColor?.val as string) ?? palette.overlay,
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
}
