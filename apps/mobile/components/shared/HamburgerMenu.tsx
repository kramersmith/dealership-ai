import { useState, useRef, useEffect } from 'react'
import { TouchableOpacity, Modal, View, Animated, Platform, Dimensions } from 'react-native'
import { YStack, XStack, Text, useTheme } from 'tamagui'
import { Menu, X, MessageSquare, List, Settings, Swords, LogOut } from '@tamagui/lucide-icons'
import { useRouter } from 'expo-router'
import { colors } from '@/lib/colors'
import { useAuthStore } from '@/stores/authStore'

const useNative = Platform.OS !== 'web'

interface MenuItem {
  label: string
  Icon: typeof MessageSquare
  route: string
}

export function HamburgerMenu() {
  const [isOpen, setIsOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 })
  const buttonRef = useRef<View>(null)
  const rotation = useRef(new Animated.Value(0)).current
  const theme = useTheme()
  const router = useRouter()
  const role = useAuthStore((s) => s.role)
  const logout = useAuthStore((s) => s.logout)

  useEffect(() => {
    Animated.timing(rotation, {
      toValue: isOpen ? 1 : 0,
      duration: 200,
      useNativeDriver: useNative,
    }).start()
  }, [isOpen])

  const rotateInterpolate = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '90deg'],
  })

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

  const handleToggle = () => {
    if (isOpen) {
      setIsOpen(false)
    } else {
      buttonRef.current?.measureInWindow((x, y, width, height) => {
        const screenWidth = Dimensions.get('window').width
        const menuWidth = 220
        const safeLeft = Math.min(x, screenWidth - menuWidth - 16)
        setMenuPosition({ top: y + height + 4, left: Math.max(8, safeLeft) })
        setIsOpen(true)
      })
    }
  }

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
      <View ref={buttonRef} collapsable={false}>
        <TouchableOpacity
          onPress={handleToggle}
          activeOpacity={0.6}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Animated.View style={{ transform: [{ rotate: rotateInterpolate }] }}>
            {isOpen ? (
              <X size={22} color="$color" />
            ) : (
              <Menu size={22} color="$color" />
            )}
          </Animated.View>
        </TouchableOpacity>
      </View>

      <Modal
        visible={isOpen}
        transparent
        animationType="none"
        onRequestClose={() => setIsOpen(false)}
      >
        <TouchableOpacity
          style={{ flex: 1 }}
          activeOpacity={1}
          onPress={() => setIsOpen(false)}
        >
          {/* Rotated square behind dropdown — peeks out as arrow nub */}
          <View
            style={{
              position: 'absolute',
              top: menuPosition.top - 7,
              left: menuPosition.left + 12,
              width: 14,
              height: 14,
              transform: [{ rotate: '45deg' }],
              backgroundColor: theme.backgroundStrong?.val ?? theme.background?.val ?? 'transparent',
              borderWidth: 1,
              borderColor: theme.borderColor?.val ?? 'transparent',
              zIndex: 1,
              ...(Platform.OS === 'web'
                ? { boxShadow: `0 2px 8px ${theme.shadowColor?.val ?? 'rgba(0,0,0,0.3)'}` }
                : { shadowColor: theme.shadowColor?.val ?? 'rgba(0,0,0,0.3)', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 4, elevation: 8 }),
            }}
          />

          {/* Dropdown body — overlaps the bottom half of the nub square */}
          <YStack
            position="absolute"
            top={menuPosition.top}
            left={menuPosition.left}
            backgroundColor="$backgroundStrong"
            borderRadius="$3"
            borderWidth={1}
            borderColor="$borderColor"
            paddingVertical="$2"
            minWidth={220}
            zIndex={2}
            {...(Platform.OS === 'web'
              ? { style: { boxShadow: `0 4px 16px ${theme.shadowColor?.val ?? 'rgba(0,0,0,0.3)'}` } }
              : { shadowColor: '$shadowColor', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 8, elevation: 9 })}
          >
            {/* Menu items */}
            {items.map((item) => (
              <TouchableOpacity
                key={item.route}
                onPress={() => navigate(item.route)}
                activeOpacity={0.6}
                style={{ minHeight: 44 }}
              >
                <XStack
                  gap="$3"
                  alignItems="center"
                  paddingVertical="$3"
                  paddingHorizontal="$4"
                >
                  <item.Icon size={18} color="$color" />
                  <Text fontSize={15} color="$color" fontWeight="500">
                    {item.label}
                  </Text>
                </XStack>
              </TouchableOpacity>
            ))}

            {/* Divider */}
            <YStack height={1} backgroundColor="$borderColor" marginVertical="$1" />

            {/* Role label */}
            <XStack paddingHorizontal="$4" paddingVertical="$2">
              <Text fontSize={11} color="$placeholderColor" textTransform="uppercase" letterSpacing={1}>
                {role === 'dealer' ? 'Dealer Mode' : 'Buyer Mode'}
              </Text>
            </XStack>

            {/* Logout */}
            <TouchableOpacity
              onPress={handleLogout}
              activeOpacity={0.6}
              style={{ minHeight: 44 }}
            >
              <XStack
                gap="$3"
                alignItems="center"
                paddingVertical="$3"
                paddingHorizontal="$4"
              >
                <LogOut size={18} color={colors.danger} />
                <Text fontSize={15} color={colors.danger} fontWeight="500">
                  Sign Out
                </Text>
              </XStack>
            </TouchableOpacity>
          </YStack>
        </TouchableOpacity>
      </Modal>
    </>
  )
}
