import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Animated, Platform, TouchableOpacity } from 'react-native'
import { useTheme } from 'tamagui'

interface HeaderIconButtonProps {
  onPress: () => void
  accessibilityLabel: string
  children: ReactNode
  filled?: boolean
  /** Web: DOM id for moving focus after opening a Modal (see `focusDomElementByIdsAfterModalShow`). */
  webDomId?: string
}

export function HeaderIconButton({
  onPress,
  accessibilityLabel,
  children,
  filled = false,
  webDomId,
}: HeaderIconButtonProps) {
  const theme = useTheme()
  const [isHovered, setIsHovered] = useState(false)
  const pressAnim = useRef(new Animated.Value(0)).current

  const handlePressIn = useCallback(() => {
    Animated.timing(pressAnim, {
      toValue: 1,
      duration: 100,
      useNativeDriver: false,
    }).start()
  }, [pressAnim])

  const handlePressOut = useCallback(() => {
    Animated.timing(pressAnim, {
      toValue: 0,
      duration: 140,
      useNativeDriver: false,
    }).start()
  }, [pressAnim])

  const scale = pressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.96],
  })
  const shadowColor = theme.shadowColor?.val as string
  const backgroundColor = (filled ? theme.backgroundHover?.val : 'transparent') as string
  const borderColor = (filled ? theme.borderColor?.val : 'transparent') as string

  return (
    <TouchableOpacity
      {...(Platform.OS === 'web' && webDomId ? ({ id: webDomId } as any) : {})}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      activeOpacity={1}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      {...(Platform.OS === 'web'
        ? {
            onMouseEnter: () => setIsHovered(true),
            onMouseLeave: () => setIsHovered(false),
          }
        : undefined)}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
    >
      <Animated.View
        style={{
          width: filled ? 36 : 44,
          height: filled ? 36 : 44,
          borderRadius: filled ? 12 : 14,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor,
          borderWidth: filled ? 1 : 0,
          borderColor,
          transform: [{ scale }, { translateY: Platform.OS === 'web' && isHovered ? -1 : 0 }],
          ...(Platform.OS === 'web'
            ? {
                boxShadow: isHovered ? `0 2px 6px ${shadowColor}` : 'none',
                transition: 'transform 160ms ease, box-shadow 160ms ease',
              }
            : null),
        }}
      >
        {children}
      </Animated.View>
    </TouchableOpacity>
  )
}
