import { Platform } from 'react-native'
import { YStack, type YStackProps } from 'tamagui'

interface AppCardProps extends YStackProps {
  children: React.ReactNode
  /** Optional brand-colored top accent line */
  accent?: boolean
}

export function AppCard({ children, accent = false, ...props }: AppCardProps) {
  return (
    <YStack
      backgroundColor="$backgroundStrong"
      borderRadius={12}
      padding="$4"
      borderWidth={1}
      borderColor="$borderColor"
      borderTopWidth={accent ? 2 : 1}
      borderTopColor={accent ? '$brand' : '$borderColor'}
      {...(Platform.OS === 'web'
        ? {
            style: {
              boxShadow: '0 1px 3px rgba(0,0,0,0.2), 0 1px 2px rgba(0,0,0,0.15)',
            },
          }
        : {
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.15,
            shadowRadius: 3,
            elevation: 2,
          })}
      {...props}
    >
      {children}
    </YStack>
  )
}
