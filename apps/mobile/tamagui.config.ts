import { config as configBase } from '@tamagui/config/v3'
import { createTamagui } from 'tamagui'
import { tokenColors } from './lib/theme/tokens'
import { darkTheme, lightTheme, subThemes } from './lib/theme/themes'

const config = createTamagui({
  ...configBase,
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
  },
})

export default config
