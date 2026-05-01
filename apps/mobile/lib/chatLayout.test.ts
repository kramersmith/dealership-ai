import { describe, expect, it } from 'vitest'

import {
  CHAT_PAGE_MAX_WIDTH_PX,
  CHAT_SCREEN_LAYOUT,
  getChatBottomPadding,
  getChatPageHorizontalPaddingPx,
  getChatPageVerticalPaddingPx,
  getContextPickerBottomPadding,
  getDesktopChatPageRailStyle,
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

describe('getChatPageHorizontalPaddingPx', () => {
  it('drops to 0 on mobile so the chat rail goes edge-to-edge', () => {
    expect(getChatPageHorizontalPaddingPx(400)).toBe(0)
    expect(getChatPageHorizontalPaddingPx(800)).toBe(24)
    expect(getChatPageHorizontalPaddingPx(1300)).toBe(32)
  })
})

describe('getChatPageVerticalPaddingPx', () => {
  it('drops to 0 on mobile so the rail sits flush below the navbar', () => {
    expect(getChatPageVerticalPaddingPx(400)).toBe(0)
    expect(getChatPageVerticalPaddingPx(900)).toBe(24)
  })
})

describe('getDesktopChatPageRailStyle', () => {
  it('is full-width stretch without inner maxWidth cap', () => {
    const style = getDesktopChatPageRailStyle()
    expect(style.width).toBe('100%')
    expect(style.alignSelf).toBe('stretch')
    expect('maxWidth' in style).toBe(false)
  })
})

describe('CHAT_PAGE_MAX_WIDTH_PX', () => {
  it('matches Stitch example main max width', () => {
    expect(CHAT_PAGE_MAX_WIDTH_PX).toBe(1600)
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

// The composer used to be absolutely positioned over the chat, so the
// message list and context picker had to reserve space equal to the
// composer's height. The composer is now a flex sibling underneath the
// scroll area, so no reserve is needed and these helpers ignore
// `isDesktop` / `desktopComposerTrayHeight`.

describe('getChatBottomPadding', () => {
  it('returns mobile padding without vin intercept (desktop or mobile)', () => {
    expect(
      getChatBottomPadding({
        isDesktop: true,
        desktopComposerTrayHeight: 100,
        pendingVinIntercept: false,
      })
    ).toBe(CHAT_SCREEN_LAYOUT.mobileChatBottomPaddingPx)
    expect(
      getChatBottomPadding({
        isDesktop: false,
        desktopComposerTrayHeight: 0,
        pendingVinIntercept: false,
      })
    ).toBe(CHAT_SCREEN_LAYOUT.mobileChatBottomPaddingPx)
  })

  it('uses pending-vin-intercept padding when an intercept is in flight', () => {
    expect(
      getChatBottomPadding({
        isDesktop: false,
        desktopComposerTrayHeight: 0,
        pendingVinIntercept: true,
      })
    ).toBe(CHAT_SCREEN_LAYOUT.mobilePendingVinInterceptBottomPaddingPx)
  })
})

describe('getContextPickerBottomPadding', () => {
  it('returns 0 (no reserve needed; composer is a flex sibling)', () => {
    expect(getContextPickerBottomPadding({ isDesktop: true, desktopComposerTrayHeight: 80 })).toBe(
      0
    )
    expect(getContextPickerBottomPadding({ isDesktop: false, desktopComposerTrayHeight: 0 })).toBe(
      0
    )
  })
})
