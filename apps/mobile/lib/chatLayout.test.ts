import { describe, expect, it } from 'vitest'

import {
  CHAT_SCREEN_LAYOUT,
  getChatBottomPadding,
  getContextPickerBottomPadding,
  getDesktopChatRailStyle,
  getDesktopComposerReservePx,
  getWebQueuePreviewRightInsetPx,
} from '@/lib/chatLayout'
import { CHAT_VIEW_MAX_WIDTH, WEB_SCROLLBAR_GUTTER_PX } from '@/lib/constants'

describe('CHAT_SCREEN_LAYOUT', () => {
  it('is a frozen object with all expected keys', () => {
    expect(CHAT_SCREEN_LAYOUT).toBeDefined()
    expect(typeof CHAT_SCREEN_LAYOUT.desktopComposerTrayBottomPx).toBe('number')
    expect(typeof CHAT_SCREEN_LAYOUT.mobileComposerTrayInsetPx).toBe('number')
    expect(typeof CHAT_SCREEN_LAYOUT.desktopComposerOverlayFallbackHeightPx).toBe('number')
    expect(typeof CHAT_SCREEN_LAYOUT.desktopComposerReserveGapPx).toBe('number')
    expect(typeof CHAT_SCREEN_LAYOUT.mobileChatBottomPaddingPx).toBe('number')
    expect(typeof CHAT_SCREEN_LAYOUT.mobilePendingVinInterceptBottomPaddingPx).toBe('number')
  })
})

describe('getDesktopChatRailStyle', () => {
  it('returns a style with maxWidth matching CHAT_VIEW_MAX_WIDTH', () => {
    const style = getDesktopChatRailStyle()
    expect(style.maxWidth).toBe(CHAT_VIEW_MAX_WIDTH)
  })

  it('returns width 100%', () => {
    const style = getDesktopChatRailStyle()
    expect(style.width).toBe('100%')
  })

  it('centers with alignSelf', () => {
    const style = getDesktopChatRailStyle()
    expect(style.alignSelf).toBe('center')
  })

  it('includes left padding from layout constants', () => {
    const style = getDesktopChatRailStyle()
    expect(style.paddingLeft).toBe(CHAT_SCREEN_LAYOUT.desktopChatRailLeftGutterPx)
  })
})

describe('getWebQueuePreviewRightInsetPx', () => {
  it('returns scrollbar gutter plus spacing for web platform', () => {
    const result = getWebQueuePreviewRightInsetPx('web')
    expect(result).toBe(WEB_SCROLLBAR_GUTTER_PX + CHAT_SCREEN_LAYOUT.webQueuePreviewSpacingPx)
  })

  it('returns 0 for non-web platforms', () => {
    expect(getWebQueuePreviewRightInsetPx('ios')).toBe(0)
    expect(getWebQueuePreviewRightInsetPx('android')).toBe(0)
  })
})

describe('getDesktopComposerReservePx', () => {
  it('uses measured height when positive', () => {
    const measured = 120
    const result = getDesktopComposerReservePx(measured)
    expect(result).toBe(
      measured +
        CHAT_SCREEN_LAYOUT.desktopComposerTrayBottomPx +
        CHAT_SCREEN_LAYOUT.desktopComposerReserveGapPx
    )
  })

  it('falls back to default height when measured is 0', () => {
    const result = getDesktopComposerReservePx(0)
    expect(result).toBe(
      CHAT_SCREEN_LAYOUT.desktopComposerOverlayFallbackHeightPx +
        CHAT_SCREEN_LAYOUT.desktopComposerTrayBottomPx +
        CHAT_SCREEN_LAYOUT.desktopComposerReserveGapPx
    )
  })

  it('falls back to default height when measured is negative', () => {
    const result = getDesktopComposerReservePx(-10)
    expect(result).toBe(
      CHAT_SCREEN_LAYOUT.desktopComposerOverlayFallbackHeightPx +
        CHAT_SCREEN_LAYOUT.desktopComposerTrayBottomPx +
        CHAT_SCREEN_LAYOUT.desktopComposerReserveGapPx
    )
  })
})

describe('getChatBottomPadding', () => {
  it('returns composer reserve on desktop', () => {
    const trayHeight = 100
    const result = getChatBottomPadding({
      isDesktop: true,
      desktopComposerTrayHeight: trayHeight,
      pendingVinIntercept: false,
    })
    expect(result).toBe(getDesktopComposerReservePx(trayHeight))
  })

  it('returns composer reserve on desktop even with vin intercept', () => {
    const trayHeight = 100
    const result = getChatBottomPadding({
      isDesktop: true,
      desktopComposerTrayHeight: trayHeight,
      pendingVinIntercept: true,
    })
    // Desktop always uses composer reserve regardless of VIN intercept
    expect(result).toBe(getDesktopComposerReservePx(trayHeight))
  })

  it('returns mobile padding without vin intercept', () => {
    const result = getChatBottomPadding({
      isDesktop: false,
      desktopComposerTrayHeight: 0,
      pendingVinIntercept: false,
    })
    expect(result).toBe(CHAT_SCREEN_LAYOUT.mobileChatBottomPaddingPx)
  })

  it('returns vin intercept padding on mobile when pending', () => {
    const result = getChatBottomPadding({
      isDesktop: false,
      desktopComposerTrayHeight: 0,
      pendingVinIntercept: true,
    })
    expect(result).toBe(CHAT_SCREEN_LAYOUT.mobilePendingVinInterceptBottomPaddingPx)
  })
})

describe('getContextPickerBottomPadding', () => {
  it('returns composer reserve on desktop', () => {
    const trayHeight = 80
    const result = getContextPickerBottomPadding({
      isDesktop: true,
      desktopComposerTrayHeight: trayHeight,
    })
    expect(result).toBe(getDesktopComposerReservePx(trayHeight))
  })

  it('returns 0 on mobile', () => {
    const result = getContextPickerBottomPadding({
      isDesktop: false,
      desktopComposerTrayHeight: 0,
    })
    expect(result).toBe(0)
  })

  it('uses fallback height on desktop when tray height is 0', () => {
    const result = getContextPickerBottomPadding({
      isDesktop: true,
      desktopComposerTrayHeight: 0,
    })
    expect(result).toBe(getDesktopComposerReservePx(0))
    expect(result).toBeGreaterThan(0)
  })
})
