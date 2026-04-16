/**
 * Shared typography for insights AiCards and PanelMarkdown so body, secondary,
 * and section labels stay visually consistent.
 */

/** Default markdown body size in panel cards. */
export const INSIGHT_PANEL_MARKDOWN_FONT_SIZE = 13

/** Body line height paired with {@link INSIGHT_PANEL_MARKDOWN_FONT_SIZE}. */
export const INSIGHT_PANEL_MARKDOWN_LINE_HEIGHT = 20

/** Scale line height with fontSize using the same ratio as the default body pair. */
export function insightMarkdownLineHeightFor(fontSize: number): number {
  return Math.round(
    fontSize * (INSIGHT_PANEL_MARKDOWN_LINE_HEIGHT / INSIGHT_PANEL_MARKDOWN_FONT_SIZE)
  )
}

/** Primary narrative text (plain `Text`) — matches PanelMarkdown body. */
export const insightCardBodyProps = {
  fontSize: INSIGHT_PANEL_MARKDOWN_FONT_SIZE,
  lineHeight: INSIGHT_PANEL_MARKDOWN_LINE_HEIGHT,
  color: '$color' as const,
}

/** Muted supporting lines (notes, comparison footnotes, secondary number labels). */
export const insightCardSecondaryProps = {
  fontSize: 12,
  lineHeight: 18,
  fontWeight: '500' as const,
  color: '$placeholderColor' as const,
}

/** Numbers / metric row labels (primary size, muted). */
export const insightCardRowLabelProps = {
  fontSize: INSIGHT_PANEL_MARKDOWN_FONT_SIZE,
  lineHeight: INSIGHT_PANEL_MARKDOWN_LINE_HEIGHT,
  fontWeight: '500' as const,
  color: '$placeholderColor' as const,
}

/** Callouts / lead lines that should read as body but stressed. */
export const insightCardEmphasisProps = {
  ...insightCardBodyProps,
  fontWeight: '600' as const,
}

/**
 * In-card section headings (e.g. numbers group keys) — same scale as {@link CardTitle}.
 */
export const insightCardSectionLabelProps = {
  fontSize: 11,
  lineHeight: 14,
  fontWeight: '700' as const,
  color: '$placeholderColor' as const,
  letterSpacing: 0.65,
  textTransform: 'uppercase' as const,
}
