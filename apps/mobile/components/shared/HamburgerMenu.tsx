import { useState } from 'react'
import { TouchableOpacity, Modal } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { Menu, X, MessageSquare, List, Settings, Swords, LogOut } from '@tamagui/lucide-icons'
import { useRouter } from 'expo-router'
import { useAuthStore } from '@/stores/authStore'
import { colors } from '@/lib/colors'

interface MenuItem {
  label: string
  Icon: typeof MessageSquare
  route: string
}

export function HamburgerMenu() {
  const [isOpen, setIsOpen] = useState(false)
  const router = useRouter()
  const role = useAuthStore((s) => s.role)
  const logout = useAuthStore((s) => s.logout)

  const buyerItems: MenuItem[] = [
    { label: 'Chat', Icon: MessageSquare, route: '/(buyer)/chat' },
    { label: 'Sessions', Icon: List, route: '/(buyer)/sessions' },
    { label: 'Settings', Icon: Settings, route: '/(buyer)/settings' },
  ]

  const dealerItems: MenuItem[] = [
    { label: 'Training', Icon: Swords, route: '/(dealer)/simulations' },
    { label: 'Settings', Icon: Settings, route: '/(dealer)/settings' },
  ]

  const items = role === 'dealer' ? dealerItems : buyerItems

  const navigate = (route: string) => {
    setIsOpen(false)
    router.push(route as any)
  }

  const handleLogout = () => {
    setIsOpen(false)
    logout()
    router.replace('/(auth)/login')
  }

  return (
    <>
      <TouchableOpacity
        onPress={() => setIsOpen(true)}
        activeOpacity={0.6}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <Menu size={22} color="$color" />
      </TouchableOpacity>

      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsOpen(false)}
      >
        <TouchableOpacity
          style={{ flex: 1 }}
          activeOpacity={1}
          onPress={() => setIsOpen(false)}
        >
          <YStack flex={1} backgroundColor="rgba(0,0,0,0.6)">
            <TouchableOpacity activeOpacity={1} onPress={() => {}}>
              <YStack
                width={280}
                height="100%"
                backgroundColor="$backgroundStrong"
                paddingTop="$4"
                paddingHorizontal="$4"
                borderRightWidth={1}
                borderRightColor="$borderColor"
              >
                {/* Close button */}
                <XStack justifyContent="flex-end" marginBottom="$4">
                  <TouchableOpacity
                    onPress={() => setIsOpen(false)}
                    activeOpacity={0.6}
                    style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <X size={22} color="$placeholderColor" />
                  </TouchableOpacity>
                </XStack>

                {/* App title */}
                <Text fontSize={20} fontWeight="700" color="$color" marginBottom="$6">
                  Deal Assistant
                </Text>

                {/* Menu items */}
                <YStack gap="$1">
                  {items.map((item) => (
                    <TouchableOpacity
                      key={item.route}
                      onPress={() => navigate(item.route)}
                      activeOpacity={0.6}
                      style={{ minHeight: 48, justifyContent: 'center' }}
                    >
                      <XStack
                        gap="$3"
                        alignItems="center"
                        paddingVertical="$3"
                        paddingHorizontal="$3"
                        borderRadius="$2"
                      >
                        <item.Icon size={20} color="$color" />
                        <Text fontSize={16} color="$color" fontWeight="500">
                          {item.label}
                        </Text>
                      </XStack>
                    </TouchableOpacity>
                  ))}
                </YStack>

                {/* Divider */}
                <YStack height={1} backgroundColor="$borderColor" marginVertical="$4" />

                {/* Role indicator */}
                <Text fontSize={12} color="$placeholderColor" marginBottom="$3" textTransform="uppercase" letterSpacing={1}>
                  {role === 'dealer' ? 'Dealer Mode' : 'Buyer Mode'}
                </Text>

                {/* Logout */}
                <TouchableOpacity
                  onPress={handleLogout}
                  activeOpacity={0.6}
                  style={{ minHeight: 48, justifyContent: 'center' }}
                >
                  <XStack
                    gap="$3"
                    alignItems="center"
                    paddingVertical="$3"
                    paddingHorizontal="$3"
                    borderRadius="$2"
                  >
                    <LogOut size={20} color="$placeholderColor" />
                    <Text fontSize={16} color="$placeholderColor" fontWeight="500">
                      Sign Out
                    </Text>
                  </XStack>
                </TouchableOpacity>
              </YStack>
            </TouchableOpacity>
          </YStack>
        </TouchableOpacity>
      </Modal>
    </>
  )
}
