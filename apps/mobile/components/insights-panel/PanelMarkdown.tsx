import { StyleSheet } from 'react-native'
import { useTheme } from 'tamagui'
import Markdown from 'react-native-markdown-display'
import {
  INSIGHT_PANEL_MARKDOWN_FONT_SIZE,
  insightMarkdownLineHeightFor,
} from '@/lib/insightsPanelTypography'
import { palette } from '@/lib/theme/tokens'

interface PanelMarkdownProps {
  children: string
  fontSize?: number
  color?: string
}

/** Lightweight markdown renderer for insights panel card text. */
export function PanelMarkdown({
  children,
  fontSize = INSIGHT_PANEL_MARKDOWN_FONT_SIZE,
  color,
}: PanelMarkdownProps) {
  const theme = useTheme()
  const textColor = color ?? (theme.color?.val as string) ?? '#E4E6EB'
  const headingColor = (theme.color?.val as string) ?? '#E4E6EB'
  const codeBg = (theme.backgroundHover?.val as string) ?? '#3A3B3C'
  const borderColor = (theme.borderColor?.val as string) ?? '#3E4042'
  const bodyLineHeight = insightMarkdownLineHeightFor(fontSize)

  const styles = StyleSheet.create({
    body: { color: textColor, fontSize, lineHeight: bodyLineHeight },
    text: { color: textColor },
    paragraph: { color: textColor, marginTop: 0, marginBottom: 6 },
    heading1: {
      color: headingColor,
      fontSize: fontSize + 2,
      fontWeight: '700',
      marginBottom: 4,
      marginTop: 8,
    },
    heading2: {
      color: headingColor,
      fontSize: fontSize + 1,
      fontWeight: '700',
      marginBottom: 4,
      marginTop: 6,
    },
    heading3: { color: headingColor, fontSize, fontWeight: '700', marginBottom: 2, marginTop: 4 },
    strong: { color: headingColor, fontWeight: '700' },
    em: { fontStyle: 'italic' },
    bullet_list: { marginBottom: 6 },
    ordered_list: { marginBottom: 6 },
    list_item: { flexDirection: 'row', marginBottom: 3 },
    bullet_list_icon: { color: textColor, fontSize, lineHeight: bodyLineHeight, marginRight: 6 },
    ordered_list_icon: { color: textColor, fontSize, lineHeight: bodyLineHeight, marginRight: 6 },
    bullet_list_content: { flex: 1 },
    ordered_list_content: { flex: 1 },
    blockquote: {
      backgroundColor: codeBg,
      borderLeftWidth: 3,
      borderLeftColor: borderColor,
      paddingHorizontal: 10,
      paddingVertical: 6,
      marginBottom: 6,
      borderRadius: 4,
    },
    code_inline: {
      backgroundColor: codeBg,
      color: headingColor,
      fontSize: fontSize - 1,
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: 3,
    },
    fence: {
      backgroundColor: codeBg,
      color: headingColor,
      fontSize: fontSize - 1,
      padding: 8,
      borderRadius: 6,
      marginBottom: 6,
    },
    hr: { backgroundColor: borderColor, height: 1, marginVertical: 8 },
    link: { color: palette.brand, textDecorationLine: 'none' },
  })

  return (
    <Markdown
      style={styles}
      onLinkPress={() => false}
      rules={{
        image: () => null,
      }}
    >
      {children}
    </Markdown>
  )
}
