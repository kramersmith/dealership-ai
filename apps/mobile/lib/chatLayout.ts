import { CHAT_VIEW_MAX_WIDTH, WEB_SCROLLBAR_GUTTER_PX } from './constants'

export const CHAT_SCREEN_LAYOUT = {
  webQueuePreviewSpacingPx: 1,
  webQueuePreviewCardWidthPx: 320,
  desktopInsightsSheetInsetPx: 0,
  desktopInsightsSheetGapPx: 16,
  desktopInsightsSheetRadiusPx: 24,
  desktopComposerTrayInsetPx: 0,
  desktopComposerTrayBottomPx: 12,
  desktopComposerTrayRadiusPx: 18,
  desktopComposerOverlayFallbackHeightPx: 96,
  desktopChatRailLeftGutterPx: 12,
  desktopDockTopOffsetPx: 12,
  desktopDockRightOffsetPx: 12,
  mobileInsightsSheetInsetPx: 0,
  mobileInsightsSheetRadiusPx: 16,
  mobileComposerTrayInsetPx: 0,
  mobileComposerTrayBottomPx: 12,
  mobileComposerTrayRadiusPx: 18,
  desktopComposerReserveGapPx: 8,
  mobileChatBottomPaddingPx: 12,
  mobilePendingVinInterceptBottomPaddingPx: 28,
} as const

/** Matches Stitch-style `main.max-w-[1600px]` shell width. */
export const CHAT_PAGE_MAX_WIDTH_PX = 1600

/**
 * Insights panel width — proportional to the page width like the source's
 * `lg:col-span-5 xl:col-span-4` 12-column grid:
 *  - ≥ 1280px (xl): 4/12 of the inner page width
 *  - 1024–1279px (lg): 5/12 of the inner page width
 * Clamped to a sensible band so cards stay readable on extreme widths.
 */
export const DESKTOP_INSIGHTS_MIN_PX = 360
export const DESKTOP_INSIGHTS_MAX_PX = 560

export function getDesktopInsightsWidthPx(screenWidth: number): number {
  const inner = Math.min(screenWidth, CHAT_PAGE_MAX_WIDTH_PX)
  const fraction = screenWidth >= 1280 ? 4 / 12 : 5 / 12
  const target = Math.round(inner * fraction)
  return Math.max(DESKTOP_INSIGHTS_MIN_PX, Math.min(DESKTOP_INSIGHTS_MAX_PX, target))
}

/** Tailwind `px-4 md:px-6 lg:px-8` on the centered chat page shell.
 *  Mobile drops the inset entirely — the chat rail extends edge-to-edge so
 *  the bubble has the most horizontal space possible (Slack/iMessage/Linear
 *  pattern on phones). */
export function getChatPageHorizontalPaddingPx(screenWidth: number): number {
  if (screenWidth >= 1024) return 32
  if (screenWidth >= 768) return 24
  return 0
}

/** Vertical inset above/below the chat rail. Mobile drops it entirely so
 *  the rail sits flush below the top-nav border-bottom and runs to the
 *  bottom of the screen — matches Slack/iMessage edge-to-edge chat. */
export function getChatPageVerticalPaddingPx(screenWidth: number): number {
  if (screenWidth >= 768) return 24
  return 0
}

export function getDesktopChatRailStyle() {
  return {
    width: '100%',
    maxWidth: CHAT_VIEW_MAX_WIDTH,
    alignSelf: 'center',
    paddingLeft: CHAT_SCREEN_LAYOUT.desktopChatRailLeftGutterPx,
  } as const
}

/** Chat rail inside the max-width page shell — full width of the left column (no inner 1040 cap). */
export function getDesktopChatPageRailStyle() {
  return {
    width: '100%',
    alignSelf: 'stretch',
  } as const
}

export function getWebQueuePreviewRightInsetPx(platformOs: string) {
  return platformOs === 'web'
    ? WEB_SCROLLBAR_GUTTER_PX + CHAT_SCREEN_LAYOUT.webQueuePreviewSpacingPx
    : 0
}

export function getDesktopComposerReservePx(measuredComposerTrayHeight: number) {
  const resolvedComposerTrayHeight =
    measuredComposerTrayHeight > 0
      ? measuredComposerTrayHeight
      : CHAT_SCREEN_LAYOUT.desktopComposerOverlayFallbackHeightPx

  return (
    resolvedComposerTrayHeight +
    CHAT_SCREEN_LAYOUT.desktopComposerTrayBottomPx +
    CHAT_SCREEN_LAYOUT.desktopComposerReserveGapPx
  )
}

export function getChatBottomPadding({
  pendingVinIntercept,
}: {
  isDesktop: boolean
  desktopComposerTrayHeight: number
  pendingVinIntercept: boolean
}) {
  // Composer is a flex sibling now; message list just needs a hair of bottom
  // breathing room above the composer's top border.
  return pendingVinIntercept
    ? CHAT_SCREEN_LAYOUT.mobilePendingVinInterceptBottomPaddingPx
    : CHAT_SCREEN_LAYOUT.mobileChatBottomPaddingPx
}

export function getContextPickerBottomPadding(_args: {
  isDesktop: boolean
  desktopComposerTrayHeight: number
}) {
  return 0
}
