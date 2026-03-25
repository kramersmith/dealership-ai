import { TouchableOpacity, Animated } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { useRouter } from 'expo-router'
import { ArrowLeftRight, LogOut, Sun, Moon, ChevronLeft } from '@tamagui/lucide-icons'
import { useAuthStore } from '@/stores/authStore'
import { useThemeStore } from '@/stores/themeStore'
import { AppCard, ThemedSafeArea } from '@/components/shared'
import { useIconEntrance } from '@/hooks/useAnimatedValue'

export default function SettingsScreen() {
  const router = useRouter()
  const backIcon = useIconEntrance()
  const { role, setRole, logout } = useAuthStore()
  const { mode, toggle } = useThemeStore()

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
        <XStack
          paddingHorizontal="$4"
          paddingVertical="$3"
          alignItems="center"
          justifyContent="space-between"
          borderBottomWidth={1}
          borderBottomColor="$borderColor"
          backgroundColor="$backgroundStrong"
        >
          <TouchableOpacity
            onPress={() => router.back()}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Animated.View
              style={{ opacity: backIcon.opacity, transform: [{ rotate: backIcon.rotate }] }}
            >
              <ChevronLeft size={24} color="$color" />
            </Animated.View>
          </TouchableOpacity>
          <Text fontSize={18} fontWeight="700" color="$color">
            Settings
          </Text>
          <XStack width={44} />
        </XStack>

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

            <TouchableOpacity onPress={toggle} activeOpacity={0.7}>
              <AppCard>
                <XStack alignItems="center" gap="$3">
                  {mode === 'dark' ? (
                    <Sun size={20} color="$brand" />
                  ) : (
                    <Moon size={20} color="$brand" />
                  )}
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
                <AppCard>
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
              <AppCard>
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
