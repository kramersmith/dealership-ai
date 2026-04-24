import { Platform } from 'react-native'
import { palette } from '@/lib/theme/tokens'

/** Used for scrollbar thumb alpha (same idea as `ChatMessageList`). */
export function withAlpha(color: string, alpha: number): string {
  const normalizedAlpha = Math.max(0, Math.min(1, alpha))

  if (color.startsWith('rgba(')) {
    return color.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, (_, r, g, b) => {
      return `rgba(${r.trim()}, ${g.trim()}, ${b.trim()}, ${normalizedAlpha})`
    })
  }

  if (color.startsWith('rgb(')) {
    return color.replace(/rgb\(([^,]+),([^,]+),([^)]+)\)/, (_, r, g, b) => {
      return `rgba(${r.trim()}, ${g.trim()}, ${b.trim()}, ${normalizedAlpha})`
    })
  }

  if (color.startsWith('#')) {
    const hex = color.slice(1)
    const expanded =
      hex.length === 3
        ? hex
            .split('')
            .map((char) => char + char)
            .join('')
        : hex.slice(0, 6)
    const r = parseInt(expanded.slice(0, 2), 16)
    const g = parseInt(expanded.slice(2, 4), 16)
    const b = parseInt(expanded.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${normalizedAlpha})`
  }

  return color
}

/**
 * Web: thin scrollbar colored like chat (`ChatMessageList`). Native: flex only.
 * Pass `theme.placeholderColor` (resolved string) for thumb tint.
 */
export function appScrollViewChromeStyle(
  placeholderColor: string | undefined,
  opts?: { scrollbarOpacity?: number }
): { flex: number; scrollbarWidth?: 'thin'; scrollbarColor?: string } {
  const opacity = opts?.scrollbarOpacity ?? 1
  const base = { flex: 1 as const }
  if (Platform.OS !== 'web') return base
  return {
    ...base,
    scrollbarWidth: 'thin',
    scrollbarColor: `${withAlpha(placeholderColor ?? palette.overlay, opacity)} transparent`,
  }
}
