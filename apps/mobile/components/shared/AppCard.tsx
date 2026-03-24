import { YStack, type YStackProps } from 'tamagui'

interface AppCardProps extends YStackProps {
  children: React.ReactNode
}

export function AppCard({ children, ...props }: AppCardProps) {
  return (
    <YStack
      backgroundColor="$backgroundStrong"
      borderRadius="$3"
      padding="$4"
      borderWidth={1}
      borderColor="$borderColor"
      {...props}
    >
      {children}
    </YStack>
  )
}
