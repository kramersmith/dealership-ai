import { TouchableOpacity } from 'react-native'
import { XStack, Text } from 'tamagui'

interface SectionHeaderProps {
  title: string
  action?: string
  onAction?: () => void
}

export function SectionHeader({ title, action, onAction }: SectionHeaderProps) {
  return (
    <XStack justifyContent="space-between" alignItems="center" marginBottom="$2">
      <Text
        fontSize={13}
        fontWeight="600"
        color="$placeholderColor"
        textTransform="uppercase"
        letterSpacing={0.5}
      >
        {title}
      </Text>
      {action && onAction && (
        <TouchableOpacity
          onPress={onAction}
          activeOpacity={0.6}
          style={{
            minWidth: 44,
            minHeight: 44,
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 8,
          }}
        >
          <Text fontSize={13} fontWeight="600" color="$brand">
            {action}
          </Text>
        </TouchableOpacity>
      )}
      {action && !onAction && (
        <Text fontSize={13} fontWeight="600" color="$placeholderColor">
          {action}
        </Text>
      )}
    </XStack>
  )
}
