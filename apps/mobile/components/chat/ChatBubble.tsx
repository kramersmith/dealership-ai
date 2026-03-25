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
  const themeTextColor = (theme.color?.val as string) ?? '#ffffff'
  const themeBodyColor = (theme.colorPress?.val as string) ?? themeTextColor

  const textColor = isUser ? '#ffffff' : themeTextColor
  // colorPress is a softer variant of the primary text — muted enough for body text
  // while keeping headings/bold (textColor) visually prominent.
  const bodyTextColor = isUser ? '#ffffff' : themeBodyColor
  const codeBg = isUser
    ? colors.brandPressed
    : ((theme.backgroundHover?.val as string) ?? '#333333')
  const subtleSurface = isUser
    ? 'rgba(255,255,255,0.1)'
    : ((theme.background?.val as string) ?? '#18191A')
  const tableBorderColor = isUser
    ? 'rgba(255,255,255,0.22)'
    : ((theme.borderColor?.val as string) ?? '#3E4042')
  const tableHeaderBg = isUser
    ? 'rgba(255,255,255,0.12)'
    : ((theme.backgroundHover?.val as string) ?? '#3A3B3C')
  // Subtle HR divider color — use backgroundHover for a soft, theme-matched line
  const hrColor = isUser
    ? 'rgba(255,255,255,0.2)'
    : ((theme.backgroundHover?.val as string) ?? '#3A3B3C')

  const markdownStyles = StyleSheet.create({
    body: { color: bodyTextColor, fontSize: 15, lineHeight: 22 },
    text: { color: bodyTextColor, fontSize: 15, lineHeight: 22 },
    textgroup: { color: bodyTextColor },
    inline: { color: bodyTextColor },
    span: { color: bodyTextColor },
    paragraph: { color: bodyTextColor, marginTop: 0, marginBottom: 8 },
    strong: { fontWeight: '700', color: textColor },
    em: { fontStyle: 'italic' },
    s: { textDecorationLine: 'line-through', color: bodyTextColor },
    heading1: { fontSize: 18, fontWeight: '700', color: textColor, marginBottom: 6, marginTop: 8 },
    heading2: { fontSize: 17, fontWeight: '700', color: textColor, marginBottom: 4, marginTop: 6 },
    heading3: { fontSize: 16, fontWeight: '600', color: textColor, marginBottom: 4, marginTop: 4 },
    heading4: { fontSize: 15, fontWeight: '600', color: textColor, marginBottom: 4, marginTop: 4 },
    heading5: { fontSize: 14, fontWeight: '600', color: textColor, marginBottom: 4, marginTop: 4 },
    heading6: { fontSize: 13, fontWeight: '600', color: textColor, marginBottom: 4, marginTop: 4 },
    bullet_list: { marginBottom: 6 },
    ordered_list: { marginBottom: 6 },
    list_item: { marginBottom: 4 },
    bullet_list_icon: { color: bodyTextColor, marginTop: 1, marginRight: 6 },
    bullet_list_content: { flex: 1 },
    ordered_list_icon: { color: bodyTextColor, marginRight: 6 },
    ordered_list_content: { flex: 1 },
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: colors.brand,
      paddingLeft: 12,
      marginVertical: 6,
      paddingVertical: 2,
      backgroundColor: subtleSurface,
      borderRadius: 8,
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
    code_block: {
      backgroundColor: codeBg,
      padding: 10,
      borderRadius: 6,
      fontSize: 13,
      fontFamily: 'monospace',
      marginVertical: 6,
      color: textColor,
    },
    pre: {
      backgroundColor: 'transparent',
      marginVertical: 0,
    },
    table: {
      borderWidth: 1,
      borderColor: tableBorderColor,
      borderRadius: 10,
      overflow: 'hidden',
      marginVertical: 10,
    },
    thead: {
      backgroundColor: tableHeaderBg,
    },
    tbody: {
      backgroundColor: 'transparent',
    },
    tr: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tableBorderColor,
    },
    th: {
      color: textColor,
      fontSize: 13,
      fontWeight: '700',
      paddingHorizontal: 12,
      paddingVertical: 10,
      textAlign: 'left',
    },
    td: {
      color: bodyTextColor,
      fontSize: 13,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    hr: {
      borderTopWidth: 0,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: hrColor,
      marginVertical: 10,
    },
    link: { color: colors.brand, textDecorationLine: 'underline' },
    blocklink: {
      borderRadius: 10,
      overflow: 'hidden',
      marginVertical: 8,
    },
    image: {
      borderRadius: 10,
      overflow: 'hidden',
      marginVertical: 8,
      backgroundColor: subtleSurface,
    },
    hardbreak: { marginBottom: 6 },
    softbreak: { marginBottom: 2 },
  })

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <XStack
        justifyContent={isUser ? 'flex-end' : 'flex-start'}
        paddingHorizontal="$4"
        paddingVertical={isUser ? '$1' : '$0.5'}
      >
        <YStack
          maxWidth={isUser ? '85%' : '100%'}
          backgroundColor={isUser ? colors.brand : '$backgroundStrong'}
          borderRadius="$4"
          borderBottomRightRadius={isUser ? '$1' : '$4'}
          borderBottomLeftRadius={isUser ? '$4' : '$1'}
          paddingHorizontal="$4"
          paddingVertical="$3"
          borderWidth={0}
          borderColor="transparent"
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
