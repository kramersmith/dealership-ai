import { StyleSheet } from 'react-native'
import { palette } from '@/lib/theme/tokens'

interface MarkdownColorParams {
  textColor: string
  bodyTextColor: string
  codeBg: string
  subtleSurface: string
  tableBorderColor: string
  tableHeaderBg: string
  hrColor: string
}

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
  return {
    textColor,
    bodyTextColor,
    codeBg: (theme.backgroundHover?.val as string) ?? palette.brandSubtle,
    subtleSurface: (theme.background?.val as string) ?? palette.brandSubtle,
    tableBorderColor: (theme.borderColor?.val as string) ?? palette.brandSubtle,
    tableHeaderBg: (theme.backgroundHover?.val as string) ?? palette.brandSubtle,
    // Use text color with opacity in `hr` style so dividers read as light gray
    // in dark mode and medium gray in light mode.
    hrColor: (theme.colorPress?.val as string) ?? palette.white,
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
      borderLeftColor: palette.brand,
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
    tableScroll: {
      width: '100%',
      marginVertical: 10,
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
      paddingHorizontal: 10,
      paddingVertical: 10,
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
    },
    tableBodyText: {
      color: bodyTextColor,
      fontSize: 13,
      lineHeight: 19,
    },
    tableLabelText: {
      fontWeight: '600',
    },
    th: {
      color: textColor,
      fontSize: 13,
      fontWeight: '700',
      paddingHorizontal: 12,
      paddingVertical: 10,
      textAlign: 'left',
      lineHeight: 18,
      minWidth: 0,
    },
    td: {
      color: bodyTextColor,
      fontSize: 13,
      paddingHorizontal: 12,
      paddingVertical: 10,
      lineHeight: 19,
      minWidth: 0,
    },
    hr: {
      height: 1,
      borderTopWidth: 0,
      borderBottomWidth: 0,
      backgroundColor: hrColor,
      opacity: 0.28,
      marginVertical: 10,
    },
    link: { color: palette.brand, textDecorationLine: 'underline' },
    blocklink: { borderRadius: 10, overflow: 'hidden', marginVertical: 8 },
    image: {
      borderRadius: 10,
      overflow: 'hidden',
      marginVertical: 8,
      backgroundColor: subtleSurface,
    },
    hardbreak: { marginBottom: 6 },
    softbreak: { marginBottom: 2 },
  })
}
