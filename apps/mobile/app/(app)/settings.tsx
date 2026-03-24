import { TouchableOpacity } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { useRouter } from 'expo-router'
import { ArrowLeftRight, LogOut, Sun, Moon } from '@tamagui/lucide-icons'
import { colors } from '@/lib/colors'
import { useAuthStore } from '@/stores/authStore'
import { useThemeStore } from '@/stores/themeStore'
import { AppCard, HamburgerMenu, ThemedSafeArea } from '@/components/shared'

export default function SettingsScreen() {
  const router = useRouter()
  const { role, setRole, logout } = useAuthStore()
  const { mode, toggle } = useThemeStore()

  const handleSwitchRole = () => {
    const newRole = role === 'buyer' ? 'dealer' : 'buyer'
    setRole(newRole)
    if (newRole === 'dealer') {
      router.replace('/(app)/simulations')
    } else {
      router.replace('/(app)/chat')
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
          <HamburgerMenu />
          <Text fontSize={18} fontWeight="700" color="$color">
            Settings
          </Text>
          <XStack width={44} />
        </XStack>

        <YStack padding="$4" gap="$5" maxWidth={480} width="100%" alignSelf="center">
          <YStack gap="$3">
            <Text fontSize={12} color="$placeholderColor" fontWeight="600" textTransform="uppercase" letterSpacing={0.5}>
              Appearance
            </Text>

            <TouchableOpacity onPress={toggle} activeOpacity={0.7}>
              <AppCard>
                <XStack alignItems="center" gap="$3">
                  {mode === 'dark' ? (
                    <Sun size={20} color={colors.brand} />
                  ) : (
                    <Moon size={20} color={colors.brand} />
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
            <Text fontSize={12} color="$placeholderColor" fontWeight="600" textTransform="uppercase" letterSpacing={0.5}>
              Account
            </Text>

            {__DEV__ && (
              <TouchableOpacity onPress={handleSwitchRole} activeOpacity={0.7}>
                <AppCard>
                  <XStack alignItems="center" gap="$3">
                    <ArrowLeftRight size={20} color={colors.brand} />
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
                  <LogOut size={20} color={colors.danger} />
                  <Text fontSize={15} fontWeight="600" color={colors.danger}>
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
