import { Platform } from 'react-native'

/**
 * Single source of truth for scrollbar appearance across the app.
 *
 * Every scrollable surface (FlatList, ScrollView, plain `overflow: auto` View
 * on web) should spread `webScrollbarStyle` into its style so the scrollbar
 * looks identical everywhere — thin track, slate-500 thumb, transparent
 * gutter, matching the dark slate-950 design.
 *
 * On native (iOS / Android) this is a no-op since the OS owns the scrollbar.
 */
export const webScrollbarStyle =
  Platform.OS === 'web'
    ? ({
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(148, 163, 184, 0.5) transparent',
      } as const)
    : ({} as const)
