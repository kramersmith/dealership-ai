import { Animated } from 'react-native'
import { YStack, XStack, Text, useTheme } from 'tamagui'
import Markdown from 'react-native-markdown-display'
import type { Message } from '@/lib/types'
import { palette } from '@/lib/theme/tokens'
import { CHAT_BUBBLE_MAX_WIDTH } from '@/lib/constants'
import { useSlideIn } from '@/hooks/useAnimatedValue'
import { buildMarkdownStyles } from './markdownStyles'
import { CopyableBlock } from './CopyableBlock'
import { extractTextFromNode } from './markdownUtils'

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
    ? palette.brandPressed
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

  const markdownStyles = buildMarkdownStyles({
    textColor,
    bodyTextColor,
    codeBg,
    subtleSurface,
    tableBorderColor,
    tableHeaderBg,
    hrColor,
  })

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <XStack
        justifyContent={isUser ? 'flex-end' : 'flex-start'}
        paddingHorizontal="$4"
        paddingVertical={isUser ? '$1' : '$0.5'}
      >
        <YStack
          style={{ maxWidth: `min(100%, ${CHAT_BUBBLE_MAX_WIDTH}px)` } as any}
          backgroundColor={isUser ? '$brand' : '$backgroundStrong'}
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
              backgroundColor={isUser ? '$brandPressed' : '$backgroundHover'}
              marginBottom="$2"
              alignItems="center"
              justifyContent="center"
            >
              <Text fontSize={12} color={isUser ? '$brandLight' : '$placeholderColor'}>
                [Photo attached]
              </Text>
            </YStack>
          )}
          {isUser ? (
            <Text fontSize={15} lineHeight={22} color="white">
              {message.content}
            </Text>
          ) : (
            <Markdown
              style={markdownStyles}
              rules={{
                blockquote: (node, children) => (
                  <CopyableBlock key={node.key} text={extractTextFromNode(node)}>
                    {children}
                  </CopyableBlock>
                ),
              }}
            >
              {message.content}
            </Markdown>
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
