import { config as configBase } from '@tamagui/config/v3'
import { createTamagui } from 'tamagui'
import { tokenColors } from './lib/theme/tokens'
import { darkCopilotTheme, darkTheme, lightTheme, subThemes } from './lib/theme/themes'
import { createManropeFont } from './lib/theme/manropeFont'

const manropeBody = createManropeFont(
  {
    weight: { 1: '400' },
  },
  {
    sizeSize: (size) => Math.round(size),
    sizeLineHeight: (size) => Math.round(size * 1.1 + (size >= 12 ? 8 : 4)),
  }
)

const manropeHeading = createManropeFont(
  {
    size: { 5: 13, 6: 15, 9: 32, 10: 44 },
    transform: { 6: 'uppercase', 7: 'none' },
    weight: { 6: '500', 7: '700' },
    color: { 6: '$colorFocus', 7: '$color' },
    letterSpacing: {
      5: 1.5,
      6: 0.6,
      7: 0,
      8: 0,
      9: -1,
      10: -1.5,
      12: -2,
      14: -3,
      15: -4,
    },
    face: {
      500: { normal: 'Manrope_500Medium' },
      600: { normal: 'Manrope_600SemiBold' },
      700: { normal: 'Manrope_700Bold' },
      800: { normal: 'Manrope_800ExtraBold' },
      900: { normal: 'Manrope_800ExtraBold' },
    },
  },
  { sizeLineHeight: (size) => Math.round(size * 1.1 + (size < 30 ? 10 : 5)) }
)

const config = createTamagui({
  ...configBase,
  fonts: {
    ...configBase.fonts,
    body: manropeBody,
    heading: manropeHeading,
  },
  tokens: {
    ...configBase.tokens,
    color: {
      ...configBase.tokens.color,
      ...tokenColors,
    },
  },
  themes: {
    ...configBase.themes,
    light: { ...configBase.themes.light, ...lightTheme },
    dark: { ...configBase.themes.dark, ...darkTheme },
    ...subThemes,
    dark_copilot: darkCopilotTheme,
  },
})

export default config
