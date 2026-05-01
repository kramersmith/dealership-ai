import { useEffect } from 'react'
import { Platform, UIManager } from 'react-native'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { TamaguiProvider, Theme } from 'tamagui'
import config from '../tamagui.config'
import { useWebAriaHiddenFocusWorkaround } from '@/hooks/useWebAriaHiddenFocusWorkaround'
import { palette } from '@/lib/theme/tokens'

/** Single app-wide theme — light mode is intentionally not supported. */
const APP_THEME = 'dark_copilot' as const

export { ErrorBoundary } from 'expo-router'

SplashScreen.preventAutoHideAsync()

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

// Dev: globalThis.mockPanel, clearPanel (see lib/dev/mockPanelUpdates.ts)
if (__DEV__) require('@/lib/dev/mockPanelUpdates')

export default function RootLayout() {
  useWebAriaHiddenFocusWorkaround()

  const manrope = require('@expo-google-fonts/manrope')
  const outfit = require('@expo-google-fonts/outfit')
  const jetbrains = require('@expo-google-fonts/jetbrains-mono')
  const [loaded, error] = useFonts({
    Inter: require('@tamagui/font-inter/otf/Inter-Regular.otf'),
    InterBold: require('@tamagui/font-inter/otf/Inter-Bold.otf'),
    Manrope: manrope.Manrope_400Regular,
    Manrope_500Medium: manrope.Manrope_500Medium,
    Manrope_600SemiBold: manrope.Manrope_600SemiBold,
    Manrope_700Bold: manrope.Manrope_700Bold,
    Manrope_800ExtraBold: manrope.Manrope_800ExtraBold,
    Outfit: outfit.Outfit_400Regular,
    Outfit_300Light: outfit.Outfit_300Light,
    Outfit_500Medium: outfit.Outfit_500Medium,
    Outfit_600SemiBold: outfit.Outfit_600SemiBold,
    Outfit_700Bold: outfit.Outfit_700Bold,
    JetBrainsMono: jetbrains.JetBrainsMono_400Regular,
    JetBrainsMono_500Medium: jetbrains.JetBrainsMono_500Medium,
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
    <TamaguiProvider config={config} defaultTheme={APP_THEME}>
      <Theme name={APP_THEME}>
        <Stack
          screenOptions={{
            headerShown: false,
            // RN-Navigation's web container paints its own bg behind our screens.
            // Force it to match our slate-950 page so the safe-area band on top
            // doesn't read as a different tone than the screen body.
            contentStyle: { backgroundColor: palette.copilotBackground },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(app)" />
        </Stack>
      </Theme>
    </TamaguiProvider>
  )
}
