import { YStack, XStack, Text } from 'tamagui'
import type { Message } from '@/lib/types'
import { colors } from '@/lib/colors'

interface ChatBubbleProps {
  message: Message
}

export function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <XStack
      justifyContent={isUser ? 'flex-end' : 'flex-start'}
      paddingHorizontal="$4"
      paddingVertical="$1"
    >
      <YStack
        maxWidth="85%"
        backgroundColor={isUser ? colors.brand : '$backgroundStrong'}
        borderRadius="$4"
        borderBottomRightRadius={isUser ? '$1' : '$4'}
        borderBottomLeftRadius={isUser ? '$4' : '$1'}
        paddingHorizontal="$4"
        paddingVertical="$3"
        borderWidth={isUser ? 0 : 1}
        borderColor="$borderColor"
      >
        {message.imageUri && (
          <YStack
            width="100%"
            height={150}
            borderRadius="$2"
            backgroundColor={isUser ? colors.brandPressed : '$backgroundHover'}
            marginBottom="$2"
            alignItems="center"
            justifyContent="center"
          >
            <Text fontSize={12} color={isUser ? colors.brandLight : '$placeholderColor'}>
              [Photo attached]
            </Text>
          </YStack>
        )}
        <Text
          fontSize={15}
          lineHeight={22}
          color={isUser ? 'white' : '$color'}
        >
          {message.content}
        </Text>
        <Text
          fontSize={10}
          color={isUser ? 'rgba(255,255,255,0.6)' : '$placeholderColor'}
          marginTop="$1"
          textAlign={isUser ? 'right' : 'left'}
        >
          {new Date(message.createdAt).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </Text>
      </YStack>
    </XStack>
  )
}
