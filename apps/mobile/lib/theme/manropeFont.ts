import { createFont, getVariableValue, isWeb } from '@tamagui/core'

/** Web fallback stack so Manrope renders cleanly before the .ttf loads. */
export const MANROPE_WEB_STACK =
  'Manrope, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

const defaultSizes = {
  1: 11,
  2: 12,
  3: 13,
  4: 14,
  true: 14,
  5: 16,
  6: 18,
  7: 20,
  8: 23,
  9: 30,
  10: 46,
  11: 55,
  12: 62,
  13: 72,
  14: 92,
  15: 114,
  16: 134,
} as const

interface ManropeOverrides {
  size?: Record<string | number, number>
  weight?: Record<string | number, string>
  letterSpacing?: Record<string | number, number>
  transform?: Record<string | number, string>
  color?: Record<string | number, string>
  face?: Record<string | number, { normal?: string; italic?: string }>
}

/**
 * Tamagui font config powered by @expo-google-fonts/manrope assets loaded in
 * `app/_layout.tsx`. Family names below match the keys passed to `useFonts`.
 */
export function createManropeFont(
  font: ManropeOverrides = {},
  {
    sizeLineHeight = (size: number) => size + 10,
    sizeSize = (size: number) => size,
  }: {
    sizeLineHeight?: (size: number) => number
    sizeSize?: (size: number) => number
  } = {}
) {
  const size = Object.fromEntries(
    Object.entries({ ...defaultSizes, ...(font.size ?? {}) }).map(([sizeKey, sizeValue]) => [
      sizeKey,
      sizeSize(Number(sizeValue)),
    ])
  ) as Record<string, number>

  const config: Record<string, unknown> = {
    family: isWeb ? MANROPE_WEB_STACK : 'Manrope',
    lineHeight: Object.fromEntries(
      Object.entries(size).map(([sizeKey, sizeValue]) => [
        sizeKey,
        sizeLineHeight(Number(getVariableValue(sizeValue))),
      ])
    ),
    weight: {
      4: '400',
      ...(font.weight ?? {}),
    },
    letterSpacing: {
      4: 0,
      ...(font.letterSpacing ?? {}),
    },
    // Native: map weights to the loaded font names (see `useFonts` in app/_layout.tsx).
    face: {
      400: { normal: 'Manrope' },
      500: { normal: 'Manrope_500Medium' },
      600: { normal: 'Manrope_600SemiBold' },
      700: { normal: 'Manrope_700Bold' },
      800: { normal: 'Manrope_800ExtraBold' },
      ...(font.face ?? {}),
    },
    size,
  }

  if (font.transform) config.transform = font.transform
  if (font.color) config.color = font.color

  return createFont(config as Parameters<typeof createFont>[0])
}
