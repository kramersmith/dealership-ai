import type { ReactNode } from 'react'
import { Platform, View, type ViewStyle } from 'react-native'
import { palette } from '@/lib/theme/tokens'

interface FrostedChatRailProps {
  children: ReactNode
  style?: ViewStyle
  /** When true, drop the rounded corners + outer border so the rail can sit
   *  flush against the navbar / screen edge. Used on mobile where the rail
   *  is the entire content area below the top nav. */
  edgeToEdge?: boolean
}

/** Left-column chat window — coach + messages + composer (reference: frosted rail inside main). */
export function FrostedChatRail({ children, style, edgeToEdge = false }: FrostedChatRailProps) {
  const base: ViewStyle = {
    flex: 1,
    minHeight: 0,
    // Source: rounded-3xl (24) border-white/10 bg-slate-900/60 backdrop-blur-xl
    borderRadius: edgeToEdge ? 0 : 24,
    borderWidth: edgeToEdge ? 0 : 1,
    borderColor: palette.ghostBorder,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    overflow: 'hidden',
    flexDirection: 'column',
    ...(Platform.OS === 'web'
      ? ({
          backdropFilter: 'blur(20px) saturate(1.15)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.15)',
        } as ViewStyle)
      : {}),
  }

  return <View style={[base, style]}>{children}</View>
}
