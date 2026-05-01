import { useState, useRef, useEffect } from 'react'
import { TouchableOpacity, Modal, View, Animated, Platform, Dimensions } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { Menu, X, Settings, Swords, LogOut } from '@tamagui/lucide-icons'
import { useRouter } from 'expo-router'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { modalWebFontFamilyStyle } from '@/lib/modalWebTypography'
import { focusDomElementByIdsAfterModalShow } from '@/lib/webModalFocus'
import { palette } from '@/lib/theme/tokens'
import { useAuthStore } from '@/stores/authStore'

interface MenuItem {
  label: string
  Icon: typeof Settings
  route: string
}

export function HamburgerMenu() {
  const [isOpen, setIsOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 })
  const buttonRef = useRef<View>(null)
  const rotation = useRef(new Animated.Value(0)).current
  const router = useRouter()
  const role = useAuthStore((state) => state.role)
  const logout = useAuthStore((state) => state.logout)

  useEffect(() => {
    Animated.timing(rotation, {
      toValue: isOpen ? 1 : 0,
      duration: 200,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start()
  }, [isOpen, rotation])

  const rotateInterpolate = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '90deg'],
  })

  const buyerItems: MenuItem[] = [{ label: 'Settings', Icon: Settings, route: '/(app)/settings' }]

  const dealerItems: MenuItem[] = [
    { label: 'Training', Icon: Swords, route: '/(app)/simulations' },
    { label: 'Settings', Icon: Settings, route: '/(app)/settings' },
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
              <X size={20} color={palette.slate400} />
            ) : (
              <Menu size={20} color={palette.slate400} />
            )}
          </Animated.View>
        </TouchableOpacity>
      </View>

      <Modal
        visible={isOpen}
        transparent
        animationType="none"
        onRequestClose={() => setIsOpen(false)}
        onShow={() =>
          focusDomElementByIdsAfterModalShow(
            'hamburger-menu-first-item',
            'hamburger-menu-focus-root'
          )
        }
      >
        {Platform.OS === 'web' ? (
          <View
            {...({ id: 'hamburger-menu-focus-root', tabIndex: -1 } as any)}
            style={{
              position: 'absolute',
              width: 1,
              height: 1,
              opacity: 0,
              overflow: 'hidden',
              pointerEvents: 'none',
            }}
          />
        ) : null}
        <TouchableOpacity
          style={{
            flex: 1,
            ...modalWebFontFamilyStyle(),
          }}
          activeOpacity={1}
          onPress={() => setIsOpen(false)}
        >
          {/* Dropdown body — frosted slate-900 panel matching the app's modal/card surfaces */}
          <YStack
            position="absolute"
            top={menuPosition.top}
            left={menuPosition.left}
            backgroundColor="rgba(15, 23, 42, 0.92)"
            borderRadius={14}
            borderWidth={1}
            borderColor={palette.ghostBorder}
            paddingVertical={6}
            minWidth={220}
            zIndex={2}
            {...(Platform.OS === 'web'
              ? {
                  style: {
                    ...modalWebFontFamilyStyle(),
                    backdropFilter: 'blur(20px) saturate(1.15)',
                    WebkitBackdropFilter: 'blur(20px) saturate(1.15)',
                  },
                }
              : {})}
          >
            {/* Menu items */}
            {items.map((item, index) => (
              <TouchableOpacity
                key={item.route}
                {...(Platform.OS === 'web' && index === 0
                  ? ({ id: 'hamburger-menu-first-item' } as any)
                  : {})}
                onPress={() => navigate(item.route)}
                activeOpacity={0.7}
                style={{ height: 44, maxHeight: 44 }}
              >
                <XStack gap="$3" alignItems="center" flex={1} paddingHorizontal={16}>
                  <item.Icon size={16} color={palette.slate300} />
                  <Text fontSize={14} color={palette.slate50} fontWeight="500">
                    {item.label}
                  </Text>
                </XStack>
              </TouchableOpacity>
            ))}

            {/* Divider */}
            <YStack
              height={1}
              backgroundColor={palette.ghostBgHover}
              marginVertical={4}
              marginHorizontal={8}
            />

            {/* Role label */}
            <XStack paddingHorizontal={16} paddingVertical={6}>
              <Text
                fontSize={11}
                color={palette.slate500}
                textTransform="uppercase"
                letterSpacing={1}
              >
                {role === 'dealer' ? 'Dealer Mode' : 'Buyer Mode'}
              </Text>
            </XStack>

            {/* Logout */}
            <TouchableOpacity
              onPress={handleLogout}
              activeOpacity={0.7}
              style={{ height: 44, maxHeight: 44 }}
            >
              <XStack gap="$3" alignItems="center" flex={1} paddingHorizontal={16}>
                <LogOut size={16} color={palette.dangerLight} />
                <Text fontSize={14} color={palette.dangerLight} fontWeight="500">
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
