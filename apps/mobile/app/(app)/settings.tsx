import { Platform, TouchableOpacity, View } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { useRouter } from 'expo-router'
import { ArrowLeftRight, LogOut, ChevronLeft } from '@tamagui/lucide-icons'
import { useAuthStore } from '@/stores/authStore'
import { CopilotTopNav, CopilotPageHero, ThemedSafeArea } from '@/components/shared'
import { palette } from '@/lib/theme/tokens'
import { PAGE_MAX_WIDTH, PAGE_PADDING_H, PAGE_PADDING_V } from '@/lib/constants'

export default function SettingsScreen() {
  const router = useRouter()
  const { role, setRole, logout } = useAuthStore()

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

  const topNav = (
    <CopilotTopNav
      leftIcon={<ChevronLeft size={20} color={palette.slate400} />}
      onLeftPress={() => router.back()}
      leftLabel="Back"
      paddingHorizontal={PAGE_PADDING_H}
    />
  )

  return (
    <ThemedSafeArea edges={['top']}>
      <YStack flex={1} backgroundColor="$background">
        {topNav}
        <View
          style={{
            flex: 1,
            width: '100%',
            maxWidth: PAGE_MAX_WIDTH,
            alignSelf: 'center',
            paddingHorizontal: PAGE_PADDING_H,
            paddingTop: PAGE_PADDING_V,
            paddingBottom: PAGE_PADDING_V,
          }}
        >
          <CopilotPageHero
            leading="Tune your"
            accent="setup"
            description="Switch role or sign out."
            isDesktop={false}
            caption={null}
          />

          <YStack gap="$5" paddingTop="$2">
            <SettingsSection title="Account">
              {__DEV__ && (
                <SettingsRow onPress={handleSwitchRole}>
                  <ArrowLeftRight size={20} color={palette.copilotEmerald} />
                  <YStack flex={1}>
                    <Text fontSize={15} fontWeight="600" color={palette.slate50}>
                      Switch to {role === 'buyer' ? 'Dealer' : 'Buyer'} Mode
                    </Text>
                    <Text fontSize={13} color={palette.slate400}>
                      Currently in {role === 'buyer' ? 'Buyer' : 'Dealer'} mode
                    </Text>
                  </YStack>
                </SettingsRow>
              )}

              <SettingsRow onPress={handleLogout}>
                <LogOut size={20} color={palette.dangerLight} />
                <Text fontSize={15} fontWeight="600" color={palette.dangerLight}>
                  Sign Out
                </Text>
              </SettingsRow>
            </SettingsSection>
          </YStack>
        </View>
      </YStack>
    </ThemedSafeArea>
  )
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <YStack gap="$3">
      <Text
        fontSize={11}
        fontWeight="600"
        color={palette.slate500}
        textTransform="uppercase"
        letterSpacing={1.2}
      >
        {title}
      </Text>
      <YStack gap="$2">{children}</YStack>
    </YStack>
  )
}

function SettingsRow({ children, onPress }: { children: React.ReactNode; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      <View
        style={{
          borderRadius: 16,
          borderWidth: 1,
          borderColor: palette.ghostBorder,
          backgroundColor: palette.copilotFrostedRail,
          paddingHorizontal: 16,
          paddingVertical: 14,
          ...(Platform.OS === 'web'
            ? ({
                backdropFilter: 'blur(20px) saturate(1.15)',
                WebkitBackdropFilter: 'blur(20px) saturate(1.15)',
              } as any)
            : {}),
        }}
      >
        <XStack alignItems="center" gap="$3">
          {children}
        </XStack>
      </View>
    </TouchableOpacity>
  )
}
