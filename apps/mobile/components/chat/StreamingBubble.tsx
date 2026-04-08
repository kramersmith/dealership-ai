import { useRef, useState, useEffect } from 'react'
import { YStack, XStack, useTheme } from 'tamagui'
import { CHAT_BUBBLE_MAX_WIDTH } from '@/lib/constants'
import { useScreenWidth } from '@/hooks/useScreenWidth'
import { buildMarkdownStyles, getAssistantMarkdownColors } from './markdownStyles'
import { ChatMarkdown } from './markdownRenderer'

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
  const { isDesktop } = useScreenWidth()
  const useInlineAssistantLayout = !isDesktop
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
    <XStack justifyContent="flex-start" paddingHorizontal="$4" paddingVertical="$0.5">
      <YStack
        style={{ maxWidth: `min(100%, ${CHAT_BUBBLE_MAX_WIDTH}px)` } as any}
        backgroundColor={useInlineAssistantLayout ? 'transparent' : '$backgroundStrong'}
        borderRadius={useInlineAssistantLayout ? 0 : '$4'}
        borderBottomLeftRadius={useInlineAssistantLayout ? 0 : '$1'}
        paddingHorizontal={useInlineAssistantLayout ? '$0' : '$4'}
        paddingVertical={useInlineAssistantLayout ? '$2' : '$3'}
        borderWidth={0}
        borderColor="transparent"
      >
        <YStack>
          <ChatMarkdown style={markdownStyles}>{visibleText}</ChatMarkdown>
        </YStack>
      </YStack>
    </XStack>
  )
}
