import { XStack, Text } from 'tamagui'

interface CardTitleProps {
  children: string
  icon?: React.ReactNode
  /** Right-aligned content (e.g., counter like "2/5") */
  right?: React.ReactNode
}

export function CardTitle({ children, icon, right }: CardTitleProps) {
  return (
    <XStack alignItems="center" gap="$1.5" paddingRight={right ? undefined : '$5'}>
      {icon}
      <Text
        fontSize={11}
        fontWeight="700"
        color="$placeholderColor"
        textTransform="uppercase"
        letterSpacing={0.65}
        flex={1}
      >
        {children}
      </Text>
      {right}
    </XStack>
  )
}
