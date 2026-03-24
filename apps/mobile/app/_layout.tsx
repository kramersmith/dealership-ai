import { useEffect } from 'react'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { TamaguiProvider, Theme } from 'tamagui'
import config from '../tamagui.config'
import { useThemeStore } from '@/stores/themeStore'

export { ErrorBoundary } from 'expo-router'

SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const mode = useThemeStore((s) => s.mode)

  const [loaded, error] = useFonts({
    Inter: require('@tamagui/font-inter/otf/Inter-Regular.otf'),
    InterBold: require('@tamagui/font-inter/otf/Inter-Bold.otf'),
  })

  useEffect(() => {
    if (error) throw error
  }, [error])

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync()
    }
  }, [loaded])

  if (!loaded) return null

  return (
    <TamaguiProvider config={config} defaultTheme={mode}>
      <Theme name={mode}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(app)" />
        </Stack>
      </Theme>
    </TamaguiProvider>
  )
}
