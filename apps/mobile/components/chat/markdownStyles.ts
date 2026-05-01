import { StyleSheet } from 'react-native'

import { palette } from '@/lib/theme/tokens'
import { MONO_FONT_FAMILY, WEB_FONT_FAMILY } from '@/lib/constants'

interface MarkdownColorParams {
  textColor: string
  bodyTextColor: string
  codeBg: string
  subtleSurface: string
  tableBorderColor: string
  tableHeaderBg: string
  hrColor: string
}

/** Body font (Manrope) applied to every text-bearing markdown rule. */
const MD_BODY_FONT = WEB_FONT_FAMILY
const MD_MONO_FONT = MONO_FONT_FAMILY

/**
 * Vertical gap between markdown chunks and embedded tables in
 * `markdownRenderer.tsx`'s outer `YStack`. (Paragraph-to-paragraph spacing
 * inside a single chunk is driven by `paragraph.marginBottom` below.)
 */
export const CHAT_MARKDOWN_BLOCK_GAP_PX = 8

/**
 * Space between paragraphs inside an assistant chat bubble.
 * `react-native-markdown-display` honors `marginBottom` on the `paragraph`
 * rule — bumping it adds breathing room between successive paragraphs in a
 * single LLM response. Containers (assistant bubble, streaming bubble,
 * `CopyableBlock`) absorb the trailing paragraph margin via a negative
 * `marginBottom` so the last line sits flush against the container's
 * bottom padding instead of leaving stray whitespace.
 */
export const CHAT_MARKDOWN_PARAGRAPH_SPACING_PX = 12

const CHAT_MARKDOWN_SECTION_SPACING_PX = 6
const CHAT_MARKDOWN_HEADING_GAP_PX = 4
const CHAT_MARKDOWN_HEADING_LARGE_TOP_SPACING_PX = 8
const CHAT_MARKDOWN_HEADING_MEDIUM_TOP_SPACING_PX = 6
const CHAT_MARKDOWN_LIST_ITEM_SPACING_PX = 2
const CHAT_MARKDOWN_RULE_SPACING_PX = 10
const CHAT_MARKDOWN_MEDIA_SPACING_PX = CHAT_MARKDOWN_BLOCK_GAP_PX
const CHAT_MARKDOWN_TABLE_CELL_PADDING_PX = 10
const CHAT_MARKDOWN_INLINE_ICON_GAP_PX = 6

/**
 * Extract assistant-bubble markdown colors from a Tamagui theme object.
 * Shared by ChatBubble (for assistant messages) and StreamingBubble.
 */
export function getAssistantMarkdownColors(theme: {
  color?: { val: string }
  colorPress?: { val: string }
  backgroundHover?: { val: string }
  background?: { val: string }
  borderColor?: { val: string }
}): MarkdownColorParams {
  const textColor = (theme.color?.val as string) ?? palette.white
  const bodyTextColor = (theme.colorPress?.val as string) ?? textColor
  const hoverSurface =
    (theme.backgroundHover?.val as string) ??
    (theme.background?.val as string) ??
    palette.brandSubtle
  const subtleSurface = (theme.background?.val as string) ?? hoverSurface
  const tableBorderColor = (theme.borderColor?.val as string) ?? hoverSurface

  return {
    textColor,
    bodyTextColor,
    codeBg: hoverSurface,
    subtleSurface,
    tableBorderColor,
    tableHeaderBg: hoverSurface,
    hrColor: (theme.colorPress?.val as string) ?? textColor,
  }
}

/** Build the react-native-markdown-display stylesheet for assistant bubbles. */
export function buildMarkdownStyles({
  textColor,
  bodyTextColor,
  codeBg,
  subtleSurface,
  tableBorderColor,
  tableHeaderBg,
  hrColor,
}: MarkdownColorParams) {
  return StyleSheet.create({
    body: {
      color: bodyTextColor,
      fontSize: 14,
      lineHeight: 22,
      marginTop: 0,
      marginBottom: 0,
      fontFamily: MD_BODY_FONT,
    },
    text: {
      color: bodyTextColor,
      fontSize: 14,
      lineHeight: 22,
      fontFamily: MD_BODY_FONT,
    },
    textgroup: { color: bodyTextColor, fontFamily: MD_BODY_FONT },
    inline: { color: bodyTextColor, fontFamily: MD_BODY_FONT },
    span: { color: bodyTextColor, fontFamily: MD_BODY_FONT },
    paragraph: {
      color: bodyTextColor,
      marginTop: 0,
      marginBottom: CHAT_MARKDOWN_PARAGRAPH_SPACING_PX,
      fontFamily: MD_BODY_FONT,
    },
    strong: { fontWeight: '600', color: textColor, fontFamily: MD_BODY_FONT },
    em: { fontStyle: 'italic', fontFamily: MD_BODY_FONT },
    s: { textDecorationLine: 'line-through', color: bodyTextColor, fontFamily: MD_BODY_FONT },
    heading1: {
      fontSize: 18,
      fontWeight: '700',
      color: textColor,
      fontFamily: MD_BODY_FONT,
      marginBottom: CHAT_MARKDOWN_SECTION_SPACING_PX,
      marginTop: CHAT_MARKDOWN_HEADING_LARGE_TOP_SPACING_PX,
    },
    heading2: {
      fontSize: 17,
      fontWeight: '700',
      color: textColor,
      fontFamily: MD_BODY_FONT,
      marginBottom: CHAT_MARKDOWN_HEADING_GAP_PX,
      marginTop: CHAT_MARKDOWN_HEADING_MEDIUM_TOP_SPACING_PX,
    },
    heading3: {
      fontSize: 16,
      fontWeight: '600',
      color: textColor,
      fontFamily: MD_BODY_FONT,
      marginBottom: CHAT_MARKDOWN_HEADING_GAP_PX,
      marginTop: CHAT_MARKDOWN_HEADING_GAP_PX,
    },
    heading4: {
      fontSize: 15,
      fontWeight: '600',
      color: textColor,
      fontFamily: MD_BODY_FONT,
      marginBottom: CHAT_MARKDOWN_HEADING_GAP_PX,
      marginTop: CHAT_MARKDOWN_HEADING_GAP_PX,
    },
    heading5: {
      fontSize: 14,
      fontWeight: '600',
      color: textColor,
      fontFamily: MD_BODY_FONT,
      marginBottom: CHAT_MARKDOWN_HEADING_GAP_PX,
      marginTop: CHAT_MARKDOWN_HEADING_GAP_PX,
    },
    heading6: {
      fontSize: 13,
      fontWeight: '600',
      color: textColor,
      fontFamily: MD_BODY_FONT,
      marginBottom: CHAT_MARKDOWN_HEADING_GAP_PX,
      marginTop: CHAT_MARKDOWN_HEADING_GAP_PX,
    },
    // Lists end with the same trailing margin as paragraphs so a paragraph
    // following a list (e.g. "To sharpen the valuation, I need…") doesn't sit
    // flush against the last bullet.
    bullet_list: { marginBottom: CHAT_MARKDOWN_PARAGRAPH_SPACING_PX },
    ordered_list: { marginBottom: CHAT_MARKDOWN_PARAGRAPH_SPACING_PX },
    list_item: { marginBottom: CHAT_MARKDOWN_LIST_ITEM_SPACING_PX },
    bullet_list_icon: {
      color: bodyTextColor,
      marginTop: 1,
      marginRight: CHAT_MARKDOWN_INLINE_ICON_GAP_PX,
    },
    bullet_list_content: { flex: 1 },
    ordered_list_icon: { color: bodyTextColor, marginRight: CHAT_MARKDOWN_INLINE_ICON_GAP_PX },
    ordered_list_content: { flex: 1 },
    blockquote: {
      borderLeftWidth: 3,
      borderLeftColor: palette.brand,
      paddingLeft: 12,
      marginVertical: CHAT_MARKDOWN_SECTION_SPACING_PX,
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
      fontFamily: MD_MONO_FONT,
    },
    fence: {
      backgroundColor: codeBg,
      padding: 10,
      borderRadius: 6,
      fontSize: 13,
      fontFamily: MD_MONO_FONT,
      marginVertical: CHAT_MARKDOWN_SECTION_SPACING_PX,
    },
    code_block: {
      backgroundColor: codeBg,
      padding: 10,
      borderRadius: 6,
      fontSize: 13,
      fontFamily: MD_MONO_FONT,
      marginVertical: CHAT_MARKDOWN_SECTION_SPACING_PX,
      color: textColor,
    },
    pre: {
      backgroundColor: 'transparent',
      marginVertical: 0,
    },
    tableScroll: {
      width: '100%',
      marginVertical: 0,
    },
    tableScrollContent: {
      minWidth: '100%',
      flexGrow: 1,
      alignItems: 'flex-start',
    },
    table: {
      borderWidth: 1,
      borderColor: tableBorderColor,
      borderRadius: 10,
      overflow: 'hidden',
      backgroundColor: subtleSurface,
      alignSelf: 'flex-start',
    },
    thead: { backgroundColor: tableHeaderBg },
    tbody: { backgroundColor: 'transparent' },
    tr: {
      flexDirection: 'row',
      alignItems: 'stretch',
      width: '100%',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tableBorderColor,
    },
    tableRowLast: {
      borderBottomWidth: 0,
    },
    tableCell: {
      paddingHorizontal: CHAT_MARKDOWN_TABLE_CELL_PADDING_PX,
      paddingVertical: CHAT_MARKDOWN_TABLE_CELL_PADDING_PX,
      justifyContent: 'center',
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: tableBorderColor,
    },
    tableCellLast: {
      borderRightWidth: 0,
    },
    tableHeaderCell: {
      backgroundColor: tableHeaderBg,
    },
    tableBodyCell: {
      backgroundColor: subtleSurface,
    },
    tableHeaderText: {
      color: textColor,
      fontSize: 13,
      fontWeight: '700',
      lineHeight: 18,
      fontFamily: MD_BODY_FONT,
    },
    tableBodyText: {
      color: bodyTextColor,
      fontSize: 13,
      lineHeight: 19,
      fontFamily: MD_BODY_FONT,
    },
    tableLabelText: {
      fontWeight: '600',
      fontFamily: MD_BODY_FONT,
    },
    th: {
      color: textColor,
      fontSize: 13,
      fontWeight: '700',
      paddingHorizontal: 12,
      paddingVertical: CHAT_MARKDOWN_TABLE_CELL_PADDING_PX,
      textAlign: 'left',
      lineHeight: 18,
      minWidth: 0,
      fontFamily: MD_BODY_FONT,
    },
    td: {
      color: bodyTextColor,
      fontSize: 13,
      paddingHorizontal: 12,
      paddingVertical: CHAT_MARKDOWN_TABLE_CELL_PADDING_PX,
      lineHeight: 19,
      minWidth: 0,
      fontFamily: MD_BODY_FONT,
    },
    hr: {
      height: 1,
      borderTopWidth: 0,
      borderBottomWidth: 0,
      backgroundColor: hrColor,
      opacity: 0.28,
      marginVertical: CHAT_MARKDOWN_RULE_SPACING_PX,
    },
    link: { color: palette.brand, textDecorationLine: 'underline' },
    blocklink: {
      borderRadius: 10,
      overflow: 'hidden',
      marginVertical: CHAT_MARKDOWN_MEDIA_SPACING_PX,
    },
    image: {
      borderRadius: 10,
      overflow: 'hidden',
      marginVertical: CHAT_MARKDOWN_MEDIA_SPACING_PX,
      backgroundColor: subtleSurface,
    },
    hardbreak: { marginBottom: CHAT_MARKDOWN_SECTION_SPACING_PX },
    softbreak: { marginBottom: CHAT_MARKDOWN_LIST_ITEM_SPACING_PX },
  })
}
