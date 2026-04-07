import { memo } from 'react'
import { Animated, Platform } from 'react-native'
import { YStack, XStack, Text, Theme, useTheme, Button } from 'tamagui'
import { RefreshCw } from '@tamagui/lucide-icons'
import Markdown from 'react-native-markdown-display'
import type { Message } from '@/lib/types'
import { palette } from '@/lib/theme/tokens'
import { APP_NAME, CHAT_BUBBLE_MAX_WIDTH } from '@/lib/constants'
import { useSlideIn } from '@/hooks/useAnimatedValue'
import { useChatStore } from '@/stores/chatStore'
import { buildMarkdownStyles, getAssistantMarkdownColors } from './markdownStyles'
import { CopyableBlock } from './CopyableBlock'
import { extractTextFromNode } from './markdownUtils'
import { QuotedCardPreview } from './QuotedCardPreview'

interface ChatBubbleProps {
  message: Message
  skipAnimation?: boolean
}

function formatUsageCount(value: number) {
  if (value >= 1000) {
    const compact = value / 1000
    return `${compact >= 10 ? Math.round(compact) : compact.toFixed(1)}k`
  }
  return String(value)
}

export const ChatBubble = memo(function ChatBubble({
  message,
  skipAnimation = false,
}: ChatBubbleProps) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const { opacity, translateY } = useSlideIn(skipAnimation ? 0 : 250)
  const theme = useTheme()
  const assistantColors = getAssistantMarkdownColors(theme)
  const usageLabel =
    !isUser && message.usage
      ? `${message.usage.requests} req · ${formatUsageCount(message.usage.inputTokens)} in · ${formatUsageCount(message.usage.outputTokens)} out`
      : null

  // User bubbles use white-on-brand; assistant bubbles use theme-derived colors
  const markdownStyles = buildMarkdownStyles(
    isUser
      ? {
          textColor: '#ffffff',
          bodyTextColor: '#ffffff',
          codeBg: palette.brandPressed,
          subtleSurface: 'rgba(255,255,255,0.1)',
          tableBorderColor: 'rgba(255,255,255,0.22)',
          tableHeaderBg: 'rgba(255,255,255,0.12)',
          hrColor: 'rgba(255,255,255,0.2)',
        }
      : assistantColors
  )

  if (isSystem) {
    return (
      <Animated.View style={{ opacity, transform: [{ translateY }] }}>
        <XStack justifyContent="center" paddingHorizontal="$4" paddingVertical="$1">
          <Theme name="warning">
            <YStack
              maxWidth={CHAT_BUBBLE_MAX_WIDTH}
              width="100%"
              backgroundColor="$background"
              borderRadius="$3"
              paddingHorizontal="$3"
              paddingVertical="$2.5"
              borderWidth={1}
              borderColor="$borderColor"
            >
              <Text fontSize={13} lineHeight={19} color="$color" textAlign="center">
                {message.content}
              </Text>
              <Text fontSize={10} color="$placeholderColor" textAlign="center" marginTop="$1">
                {new Date(message.createdAt).toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </Text>
            </YStack>
          </Theme>
        </XStack>
      </Animated.View>
    )
  }

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
          {/* Hidden sender label — invisible but included when copy-pasting */}
          {Platform.OS === 'web' && (
            <Text
              style={
                {
                  position: 'absolute',
                  width: 1,
                  height: 1,
                  margin: -1,
                  padding: 0,
                  overflow: 'hidden',
                  clip: 'rect(0, 0, 0, 0)',
                  whiteSpace: 'nowrap',
                  borderWidth: 0,
                  opacity: 0,
                  pointerEvents: 'none',
                  fontSize: 1,
                  lineHeight: 1,
                } as any
              }
              aria-hidden
            >
              {isUser ? 'You' : APP_NAME}
              {' — '}
              {new Date(message.createdAt).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })}
              {'\n'}
            </Text>
          )}
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
          {isUser && message.quotedCard && <QuotedCardPreview card={message.quotedCard} />}
          {isUser ? (
            <Text fontSize={15} lineHeight={22} color="$white">
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
            color={isUser ? '$white' : '$placeholderColor'}
            opacity={isUser ? 0.6 : 1}
            marginTop="$1"
            textAlign={isUser ? 'right' : 'left'}
          >
            {new Date(message.createdAt).toLocaleTimeString([], {
              hour: 'numeric',
              minute: '2-digit',
            })}
            {usageLabel ? ` · ${usageLabel}` : ''}
          </Text>
          {isUser && message.status === 'failed' && <FailedMessageFooter messageId={message.id} />}
        </YStack>
      </XStack>
    </Animated.View>
  )
})

function FailedMessageFooter({ messageId }: { messageId: string }) {
  const retrySend = useChatStore((s) => s.retrySend)

  return (
    <YStack marginTop="$3" paddingTop="$3" gap="$3" width="100%" alignItems="stretch">
      <YStack height={1} width="100%" backgroundColor="$white" opacity={0.22} />
      <YStack gap="$2.5" alignItems="stretch">
        <Text fontSize={12} lineHeight={18} color="$white" opacity={0.92} textAlign="center">
          This message didn&apos;t send.
        </Text>
        <Button
          size="$4"
          minHeight={44}
          width="100%"
          backgroundColor="$white"
          borderRadius="$3"
          onPress={() => retrySend(messageId)}
          pressStyle={{ opacity: 0.9, scale: 0.99 }}
          {...(Platform.OS === 'web' ? { hoverStyle: { opacity: 0.96 } } : {})}
          accessibilityLabel="Try again to send this message"
        >
          <XStack gap="$2" alignItems="center" justifyContent="center">
            <RefreshCw size={18} color="$brand" />
            <Button.Text color="$brand" fontWeight="700" fontSize={15}>
              Try again
            </Button.Text>
          </XStack>
        </Button>
      </YStack>
    </YStack>
  )
}
