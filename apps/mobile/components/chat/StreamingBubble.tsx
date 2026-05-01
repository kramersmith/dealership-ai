import { useRef, useState, useEffect } from 'react'
import { YStack, XStack, useTheme, useThemeName } from 'tamagui'
import { palette } from '@/lib/theme/tokens'
import { CHAT_BUBBLE_MAX_WIDTH, DESKTOP_ASSISTANT_BUBBLE_MAX_WIDTH } from '@/lib/constants'
import { useScreenWidth } from '@/hooks/useScreenWidth'
import {
  buildMarkdownStyles,
  CHAT_MARKDOWN_PARAGRAPH_SPACING_PX,
  getAssistantMarkdownColors,
} from './markdownStyles'
import { ChatMarkdown } from './markdownRenderer'
import { AssistantAvatar } from './AssistantAvatar'

interface StreamingBubbleProps {
  text: string
}

/** Characters to reveal per frame tick (~60fps). */
const CHARS_PER_TICK = 3
/** Minimum ms between markdown re-renders to avoid layout thrash. */
const RENDER_INTERVAL_MS = 50
const CURSOR = '▍'

export function StreamingBubble({ text }: StreamingBubbleProps) {
  const [visibleLength, setVisibleLength] = useState(0)
  const [cursorVisible, setCursorVisible] = useState(true)
  const targetLength = useRef(0)
  const rafId = useRef<number>(0)
  const lastRender = useRef(0)
  const theme = useTheme()
  const themeName = useThemeName()
  const isCopilotChat = themeName === 'dark_copilot'
  const { isDesktop } = useScreenWidth()
  const useInlineAssistantLayout = !isDesktop
  const railHorizontalPadding = isDesktop ? '$0' : '$4'
  const bubbleMaxWidth = isDesktop ? DESKTOP_ASSISTANT_BUBBLE_MAX_WIDTH : CHAT_BUBBLE_MAX_WIDTH
  const colors = getAssistantMarkdownColors(theme)

  // Keep target in sync with incoming text
  useEffect(() => {
    targetLength.current = text.length
  }, [text])

  // Animation loop: catch visibleLength up to targetLength
  useEffect(() => {
    const tick = () => {
      const now = Date.now()
      if (now - lastRender.current < RENDER_INTERVAL_MS) {
        rafId.current = requestAnimationFrame(tick)
        return
      }

      setVisibleLength((prev) => {
        const target = targetLength.current
        if (prev >= target) return prev
        // Jump ahead by CHARS_PER_TICK, or more if we're falling behind
        const gap = target - prev
        const step = gap > 80 ? Math.ceil(gap / 4) : CHARS_PER_TICK
        return Math.min(prev + step, target)
      })
      lastRender.current = now
      rafId.current = requestAnimationFrame(tick)
    }

    rafId.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId.current)
  }, [])

  // Blink cursor — toggles every 500ms
  useEffect(() => {
    const interval = setInterval(() => setCursorVisible((v) => !v), 500)
    return () => clearInterval(interval)
  }, [])

  const visibleText = text.slice(0, visibleLength) + (cursorVisible ? CURSOR : '')
  const markdownStyles = buildMarkdownStyles(colors)

  return (
    <XStack
      justifyContent="flex-start"
      paddingHorizontal={railHorizontalPadding}
      paddingVertical="$0.5"
      alignItems="flex-start"
    >
      <YStack
        flex={isCopilotChat ? 1 : undefined}
        style={{ maxWidth: `min(100%, ${bubbleMaxWidth}px)` } as any}
        backgroundColor={
          useInlineAssistantLayout
            ? 'transparent'
            : isCopilotChat
              ? (palette.copilotChatAssistantBg as any)
              : '$backgroundStrong'
        }
        borderRadius={useInlineAssistantLayout ? 0 : 16}
        borderBottomLeftRadius={useInlineAssistantLayout ? 0 : 4}
        paddingHorizontal={useInlineAssistantLayout ? 0 : 14}
        paddingVertical={useInlineAssistantLayout ? 8 : 12}
        borderWidth={useInlineAssistantLayout ? 0 : isCopilotChat ? 1 : 0}
        borderColor={
          useInlineAssistantLayout
            ? 'transparent'
            : isCopilotChat
              ? (palette.copilotChatAssistantBorder as any)
              : 'transparent'
        }
      >
        <YStack marginBottom={-CHAT_MARKDOWN_PARAGRAPH_SPACING_PX}>
          <ChatMarkdown style={markdownStyles}>{visibleText}</ChatMarkdown>
        </YStack>
      </YStack>
    </XStack>
  )
}
