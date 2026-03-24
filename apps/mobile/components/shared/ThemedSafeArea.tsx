import { SafeAreaView, type SafeAreaViewProps } from 'react-native-safe-area-context'
import { useThemeStore } from '@/stores/themeStore'

const BG = { dark: '#18191A', light: '#F0F2F5' } as const

export function ThemedSafeArea({ style, ...props }: SafeAreaViewProps) {
  const mode = useThemeStore((s) => s.mode)
  return (
    <SafeAreaView
      style={[{ flex: 1, backgroundColor: BG[mode] }, style]}
      {...props}
    />
  )
}
