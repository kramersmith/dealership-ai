/**
 * Theme definitions — dark/light base themes and semantic sub-themes.
 *
 * Sub-themes inherit unspecified keys from their parent (dark or light).
 * Wrap any subtree with `<Theme name="danger">` to activate a sub-theme.
 */

import { palette } from './tokens'

// ─── Base Themes ───

export const lightTheme = {
  background: '#F0F2F5',
  backgroundStrong: '#FFFFFF',
  backgroundHover: '#E4E6EB',
  backgroundPress: '#E4E6EB',
  backgroundFocus: '#E4E6EB',
  color: '#1C1E21',
  colorHover: '#1C1E21',
  colorPress: '#3A3D42',
  colorFocus: '#1C1E21',
  borderColor: '#CED0D4',
  borderColorHover: '#2D88FF',
  borderColorFocus: '#2D88FF',
  borderColorPress: '#CED0D4',
  placeholderColor: '#8A8D91',
  shadowColor: 'rgba(0,0,0,0.08)',
  shadowColorHover: 'rgba(0,0,0,0.12)',
  /** Icon wells (e.g. ContextPicker); token default is too dark on light surfaces. */
  brandSubtle: 'rgba(45, 136, 255, 0.12)',
} as const

export const darkTheme = {
  // Facebook dark mode palette
  background: '#18191A',
  backgroundStrong: '#242526',
  backgroundHover: '#3A3B3C',
  backgroundPress: '#3A3B3C',
  backgroundFocus: '#3A3B3C',
  color: '#E4E6EB',
  colorHover: '#E4E6EB',
  colorPress: '#C8CCD1',
  colorFocus: '#E4E6EB',
  borderColor: '#3E4042',
  borderColorHover: '#2D88FF',
  borderColorFocus: '#2D88FF',
  borderColorPress: '#3E4042',
  placeholderColor: '#B0B3B8',
  shadowColor: 'rgba(0,0,0,0.4)',
  shadowColorHover: 'rgba(0,0,0,0.5)',
  color1: '#18191A',
  color2: '#242526',
  color3: '#3A3B3C',
  color4: '#3E4042',
  color5: '#4E4F50',
  color6: '#606162',
  color7: '#8A8D91',
  color8: '#B0B3B8',
  color9: '#2D88FF',
  color10: '#1877F2',
  color11: '#C8CCD1',
  color12: '#E4E6EB',
  brandSubtle: palette.brandSubtle,
} as const

// ─── Semantic Sub-Themes ───

export const subThemes = {
  light_danger: {
    background: '#FEF2F2',
    borderColor: '#FECACA',
    color: '#DC2626',
  },
  dark_danger: {
    background: '#3B1111',
    borderColor: '#7F1D1D',
    color: '#EF4444',
  },
  light_warning: {
    background: '#FEFCE8',
    borderColor: '#FEF08A',
    color: '#CA8A04',
  },
  dark_warning: {
    background: '#3B2F08',
    borderColor: '#78350F',
    color: '#EAB308',
  },
  light_success: {
    background: '#F0FDF4',
    borderColor: '#BBF7D0',
    color: '#16A34A',
  },
  dark_success: {
    background: '#0A2E1A',
    borderColor: '#14532D',
    color: '#22C55E',
  },
} as const
