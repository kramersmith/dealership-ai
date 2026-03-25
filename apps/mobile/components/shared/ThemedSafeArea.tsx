import { SafeAreaView, type SafeAreaViewProps } from 'react-native-safe-area-context'
import { useTheme } from 'tamagui'
import { darkTheme } from '@/lib/theme/themes'

export function ThemedSafeArea({ style, ...props }: SafeAreaViewProps) {
  const theme = useTheme()
  const backgroundColor = (theme.background?.val as string) ?? darkTheme.background
  return <SafeAreaView style={[{ flex: 1, backgroundColor }, style]} {...props} />
}
