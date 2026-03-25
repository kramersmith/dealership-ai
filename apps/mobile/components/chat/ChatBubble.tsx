import { Animated, StyleSheet } from 'react-native'
import { YStack, XStack, Text, useTheme } from 'tamagui'
import Markdown from 'react-native-markdown-display'
import type { Message } from '@/lib/types'
import { colors } from '@/lib/colors'
import { useSlideIn } from '@/hooks/useAnimatedValue'

interface ChatBubbleProps {
  message: Message
}

export function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.role === 'user'
  const { opacity, translateY } = useSlideIn(250)
  const theme = useTheme()

  const textColor = isUser ? '#ffffff' : ((theme.color?.val as string) ?? '#ffffff')
  const codeBg = isUser
    ? colors.brandPressed
    : ((theme.backgroundHover?.val as string) ?? '#333333')
  const borderColor = isUser ? 'transparent' : ((theme.borderColor?.val as string) ?? '#333333')

  const markdownStyles = StyleSheet.create({
    body: { color: textColor, fontSize: 15, lineHeight: 22 },
    paragraph: { marginTop: 0, marginBottom: 8 },
    strong: { fontWeight: '700', color: textColor },
    em: { fontStyle: 'italic' },
    heading1: { fontSize: 18, fontWeight: '700', color: textColor, marginBottom: 6, marginTop: 8 },
    heading2: { fontSize: 17, fontWeight: '700', color: textColor, marginBottom: 4, marginTop: 6 },
    heading3: { fontSize: 16, fontWeight: '600', color: textColor, marginBottom: 4, marginTop: 4 },
    bullet_list: { marginBottom: 4 },
    ordered_list: { marginBottom: 4 },
    list_item: { marginBottom: 2 },
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: colors.brand,
      paddingLeft: 12,
      marginVertical: 6,
      backgroundColor: 'transparent',
    },
    code_inline: {
      backgroundColor: codeBg,
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: 3,
      fontSize: 13,
      fontFamily: 'monospace',
    },
    fence: {
      backgroundColor: codeBg,
      padding: 10,
      borderRadius: 6,
      fontSize: 13,
      fontFamily: 'monospace',
      marginVertical: 6,
    },
    hr: { borderColor, marginVertical: 10 },
    link: { color: colors.brand },
  })

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
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
          {isUser ? (
            <Text fontSize={15} lineHeight={22} color="white">
              {message.content}
            </Text>
          ) : (
            <Markdown style={markdownStyles}>{message.content}</Markdown>
          )}
          <Text
            fontSize={10}
            color={isUser ? 'white' : '$placeholderColor'}
            opacity={isUser ? 0.6 : 1}
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
    </Animated.View>
  )
}
