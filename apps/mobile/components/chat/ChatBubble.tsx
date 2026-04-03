import { memo } from 'react'
import { Animated, Platform, Pressable } from 'react-native'
import { YStack, XStack, Text, useTheme } from 'tamagui'
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
                  overflow: 'hidden',
                  opacity: 0,
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
        </YStack>
        {message.status === 'failed' && <FailedIndicator messageId={message.id} />}
      </XStack>
    </Animated.View>
  )
})

function FailedIndicator({ messageId }: { messageId: string }) {
  const retrySend = useChatStore((s) => s.retrySend)
  return (
    <Pressable
      onPress={() => retrySend(messageId)}
      hitSlop={8}
      style={{ minHeight: 44, justifyContent: 'center' }}
    >
      <XStack alignItems="center" gap="$1.5" paddingTop="$1">
        <Text fontSize={11} color="$danger">
          Failed to send
        </Text>
        <Text fontSize={11} color="$danger" fontWeight="600">
          — Tap to retry
        </Text>
      </XStack>
    </Pressable>
  )
}
