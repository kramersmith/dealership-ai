import { useRef, useState, useEffect } from 'react'
import { YStack, XStack, useTheme } from 'tamagui'
import Markdown from 'react-native-markdown-display'
import { CHAT_BUBBLE_MAX_WIDTH } from '@/lib/constants'
import { buildMarkdownStyles } from './markdownStyles'
import { CopyableBlock } from './CopyableBlock'
import { extractTextFromNode } from './markdownUtils'

interface StreamingBubbleProps {
  text: string
}

/** Characters to reveal per frame tick (~60fps). */
const CHARS_PER_TICK = 3
/** Minimum ms between markdown re-renders to avoid layout thrash. */
const RENDER_INTERVAL_MS = 50

export function StreamingBubble({ text }: StreamingBubbleProps) {
  const [visibleLength, setVisibleLength] = useState(0)
  const targetLength = useRef(0)
  const rafId = useRef<number>(0)
  const lastRender = useRef(0)
  const theme = useTheme()

  const themeTextColor = (theme.color?.val as string) ?? '#ffffff'
  const themeBodyColor = (theme.colorPress?.val as string) ?? themeTextColor

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

  const visibleText = text.slice(0, visibleLength)

  const markdownStyles = buildMarkdownStyles({
    textColor: themeTextColor,
    bodyTextColor: themeBodyColor,
    codeBg: (theme.backgroundHover?.val as string) ?? '#333333',
    subtleSurface: (theme.background?.val as string) ?? '#18191A',
    tableBorderColor: (theme.borderColor?.val as string) ?? '#3E4042',
    tableHeaderBg: (theme.backgroundHover?.val as string) ?? '#3A3B3C',
    hrColor: (theme.backgroundHover?.val as string) ?? '#3A3B3C',
  })

  return (
    <XStack justifyContent="flex-start" paddingHorizontal="$4" paddingVertical="$0.5">
      <YStack
        style={{ maxWidth: `min(100%, ${CHAT_BUBBLE_MAX_WIDTH}px)` } as any}
        backgroundColor="$backgroundStrong"
        borderRadius="$4"
        borderBottomLeftRadius="$1"
        paddingHorizontal="$4"
        paddingVertical="$3"
        borderWidth={0}
        borderColor="transparent"
      >
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
          {visibleText}
        </Markdown>
      </YStack>
    </XStack>
  )
}
