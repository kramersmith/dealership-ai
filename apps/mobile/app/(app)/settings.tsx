import { useRef, useCallback } from 'react'
import { TouchableOpacity, Animated } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { useRouter } from 'expo-router'
import { useIsFocused } from '@react-navigation/native'
import { ArrowLeftRight, LogOut, Sun, Moon, ChevronLeft } from '@tamagui/lucide-icons'
import { useAuthStore } from '@/stores/authStore'
import { useThemeStore } from '@/stores/themeStore'
import { AppCard, ThemedSafeArea, ScreenHeader } from '@/components/shared'
import { USE_NATIVE_DRIVER } from '@/lib/platform'

export default function SettingsScreen() {
  const router = useRouter()
  const isFocused = useIsFocused()
  const { role, setRole, logout } = useAuthStore()
  const { mode, toggle } = useThemeStore()
  const themeRotation = useRef(new Animated.Value(0)).current

  const handleThemeToggle = useCallback(() => {
    themeRotation.setValue(0)
    Animated.timing(themeRotation, {
      toValue: 1,
      duration: 300,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start()
    toggle()
  }, [toggle, themeRotation])

  const themeIconRotate = themeRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  })

  const handleSwitchRole = () => {
    const newRole = role === 'buyer' ? 'dealer' : 'buyer'
    setRole(newRole)
    if (newRole === 'dealer') {
      router.replace('/(app)/simulations')
    } else {
      router.replace('/(app)/chats')
    }
  }

  const handleLogout = () => {
    logout()
    router.replace('/(auth)/login')
  }

  return (
    <ThemedSafeArea edges={['top']}>
      <YStack flex={1} backgroundColor="$background">
        <ScreenHeader
          leftIcon={<ChevronLeft size={24} color="$color" />}
          onLeftPress={() => router.back()}
          leftLabel="Go back"
          title="Settings"
          iconTrigger={isFocused}
        />

        <YStack padding="$4" gap="$5" maxWidth={480} width="100%" alignSelf="center">
          <YStack gap="$3">
            <Text
              fontSize={12}
              color="$placeholderColor"
              fontWeight="600"
              textTransform="uppercase"
              letterSpacing={0.5}
            >
              Appearance
            </Text>

            <TouchableOpacity onPress={handleThemeToggle} activeOpacity={0.7}>
              <AppCard interactive>
                <XStack alignItems="center" gap="$3">
                  <Animated.View style={{ transform: [{ rotate: themeIconRotate }] }}>
                    {mode === 'dark' ? (
                      <Sun size={20} color="$brand" />
                    ) : (
                      <Moon size={20} color="$brand" />
                    )}
                  </Animated.View>
                  <YStack flex={1}>
                    <Text fontSize={15} fontWeight="600" color="$color">
                      {mode === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                    </Text>
                    <Text fontSize={13} color="$placeholderColor">
                      Currently {mode === 'dark' ? 'dark' : 'light'}
                    </Text>
                  </YStack>
                </XStack>
              </AppCard>
            </TouchableOpacity>
          </YStack>

          <YStack gap="$3">
            <Text
              fontSize={12}
              color="$placeholderColor"
              fontWeight="600"
              textTransform="uppercase"
              letterSpacing={0.5}
            >
              Account
            </Text>

            {__DEV__ && (
              <TouchableOpacity onPress={handleSwitchRole} activeOpacity={0.7}>
                <AppCard interactive>
                  <XStack alignItems="center" gap="$3">
                    <ArrowLeftRight size={20} color="$brand" />
                    <YStack flex={1}>
                      <Text fontSize={15} fontWeight="600" color="$color">
                        Switch to {role === 'buyer' ? 'Dealer' : 'Buyer'} Mode
                      </Text>
                      <Text fontSize={13} color="$placeholderColor">
                        Currently in {role === 'buyer' ? 'Buyer' : 'Dealer'} mode
                      </Text>
                    </YStack>
                  </XStack>
                </AppCard>
              </TouchableOpacity>
            )}

            <TouchableOpacity onPress={handleLogout} activeOpacity={0.7}>
              <AppCard interactive>
                <XStack alignItems="center" gap="$3">
                  <LogOut size={20} color="$danger" />
                  <Text fontSize={15} fontWeight="600" color="$danger">
                    Sign Out
                  </Text>
                </XStack>
              </AppCard>
            </TouchableOpacity>
          </YStack>
        </YStack>
      </YStack>
    </ThemedSafeArea>
  )
}
