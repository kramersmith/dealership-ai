/**
 * Raw color palette — the single source of truth for all color values.
 *
 * Use `palette` when you need a raw hex string (e.g. StyleSheet.create,
 * Animated.View style, RN Modal backgroundColor).
 *
 * Use `tokenColors` to register these as Tamagui tokens so components
 * can reference them via `$brand`, `$danger`, etc.
 */

export const palette = {
  brand: '#2D88FF',
  brandPressed: '#1877F2',
  brandLight: '#4599FF',
  brandSubtle: '#263240',

  positive: '#22C55E',
  warning: '#EAB308',
  danger: '#EF4444',
  dangerPressed: '#DC2626',

  /** For text/icons on colored surfaces (status pills, brand buttons). */
  white: '#FFFFFF',
  whiteTint10: 'rgba(255,255,255,0.1)',
  whiteTint12: 'rgba(255,255,255,0.12)',
  whiteTint20: 'rgba(255,255,255,0.2)',
  whiteTint22: 'rgba(255,255,255,0.22)',

  overlay: 'rgba(0,0,0,0.6)',
} as const

/** Merged into createTamagui tokens.color so `$brand` etc. resolve in Tamagui props. */
export const tokenColors = {
  brand: palette.brand,
  brandPressed: palette.brandPressed,
  brandLight: palette.brandLight,
  brandSubtle: palette.brandSubtle,
  positive: palette.positive,
  warning: palette.warning,
  danger: palette.danger,
  dangerPressed: palette.dangerPressed,
  white: palette.white,
} as const
