import { useCallback, useRef, type ReactNode } from 'react'
import { Animated, Platform, TouchableOpacity } from 'react-native'
import { palette } from '@/lib/theme/tokens'
import { useHoverState } from '@/hooks/useHoverState'

interface HeaderIconButtonProps {
  onPress: () => void
  accessibilityLabel: string
  children: ReactNode
  /**
   * @deprecated Kept for backwards-compatibility. The default style now
   * already has a subtle ghost surface, so this prop is a no-op.
   */
  filled?: boolean
  /** Web: DOM id for moving focus after opening a Modal (see `focusDomElementByIdsAfterModalShow`). */
  webDomId?: string
  /** Disables the press handler and dims the visible chrome. */
  disabled?: boolean
}

/** Ghost-style icon button — matches the rest of the new design system
 *  (InsightsPanel header controls, settings rows, insights toggle): a subtle
 *  rgba surface that brightens on hover, no shadow. */
export function HeaderIconButton({
  onPress,
  accessibilityLabel,
  children,
  webDomId,
  disabled = false,
}: HeaderIconButtonProps) {
  const { isHovered, hoverHandlers } = useHoverState(disabled)
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

  const backgroundColor = isHovered ? palette.ghostBgHover : palette.ghostBg
  const borderColor = isHovered ? palette.ghostBorderHover : palette.ghostBorder

  return (
    <TouchableOpacity
      {...(Platform.OS === 'web' && webDomId ? ({ id: webDomId } as any) : {})}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      activeOpacity={1}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={disabled ? { disabled: true } : undefined}
      {...hoverHandlers}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
    >
      <Animated.View
        style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor,
          borderWidth: 1,
          borderColor,
          opacity: disabled ? 0.5 : 1,
          transform: [{ scale }],
          ...(Platform.OS === 'web'
            ? {
                transition: 'background-color 160ms ease, border-color 160ms ease',
              }
            : null),
        }}
      >
        {children}
      </Animated.View>
    </TouchableOpacity>
  )
}
