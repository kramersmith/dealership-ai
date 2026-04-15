import { CHAT_VIEW_MAX_WIDTH, WEB_SCROLLBAR_GUTTER_PX } from './constants'

export const CHAT_SCREEN_LAYOUT = {
  webQueuePreviewSpacingPx: 1,
  webQueuePreviewCardWidthPx: 320,
  desktopInsightsSheetInsetPx: 0,
  desktopInsightsSheetGapPx: 0,
  desktopInsightsSheetRadiusPx: 16,
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

export function getDesktopChatRailStyle() {
  return {
    width: '100%',
    maxWidth: CHAT_VIEW_MAX_WIDTH,
    alignSelf: 'center',
    paddingLeft: CHAT_SCREEN_LAYOUT.desktopChatRailLeftGutterPx,
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
  isDesktop,
  desktopComposerTrayHeight,
  pendingVinIntercept,
}: {
  isDesktop: boolean
  desktopComposerTrayHeight: number
  pendingVinIntercept: boolean
}) {
  if (isDesktop) {
    return getDesktopComposerReservePx(desktopComposerTrayHeight)
  }

  return pendingVinIntercept
    ? CHAT_SCREEN_LAYOUT.mobilePendingVinInterceptBottomPaddingPx
    : CHAT_SCREEN_LAYOUT.mobileChatBottomPaddingPx
}

export function getContextPickerBottomPadding({
  isDesktop,
  desktopComposerTrayHeight,
}: {
  isDesktop: boolean
  desktopComposerTrayHeight: number
}) {
  return isDesktop ? getDesktopComposerReservePx(desktopComposerTrayHeight) : 0
}
