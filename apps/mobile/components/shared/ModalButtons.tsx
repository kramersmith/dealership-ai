import { type ReactNode } from 'react'
import { Platform, Pressable } from 'react-native'
import { Text } from 'tamagui'
import { palette } from '@/lib/theme/tokens'
import { useHoverState } from '@/hooks/useHoverState'

/**
 * Ghost-style cancel/dismiss button — matches the rest of the design system
 * (rgba surface, rgba border, brightens on hover).
 */
export function ModalGhostButton({
  children,
  onPress,
  webDomId,
  flex,
  disabled = false,
}: {
  children: ReactNode
  onPress: () => void
  webDomId?: string
  flex?: number
  disabled?: boolean
}) {
  const { isHovered, hoverHandlers } = useHoverState(disabled)

  return (
    <Pressable
      {...(Platform.OS === 'web' && webDomId ? ({ id: webDomId } as any) : {})}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={disabled ? { disabled: true } : undefined}
      {...hoverHandlers}
      style={({ pressed }) => ({
        height: 40,
        minWidth: 88,
        flex,
        paddingHorizontal: 16,
        borderRadius: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: isHovered ? palette.ghostBgHover : palette.ghostBg,
        borderWidth: 1,
        borderColor: isHovered ? palette.ghostBorderHover : palette.ghostBorder,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        ...(Platform.OS === 'web'
          ? ({
              cursor: disabled ? 'default' : 'pointer',
              transition: 'background-color 160ms ease, border-color 160ms ease',
            } as any)
          : null),
      })}
    >
      <Text fontSize={14} fontWeight="600" color={palette.slate200}>
        {children}
      </Text>
    </Pressable>
  )
}

/**
 * Primary confirm/action button — solid white surface with slate text.
 * `variant="danger"` switches to red bg + white text for destructive flows.
 */
export function ModalPrimaryButton({
  children,
  onPress,
  variant = 'primary',
  webDomId,
  flex,
  disabled = false,
}: {
  children: ReactNode
  onPress: () => void
  variant?: 'primary' | 'danger'
  webDomId?: string
  flex?: number
  disabled?: boolean
}) {
  const { isHovered, hoverHandlers } = useHoverState(disabled)

  const isDanger = variant === 'danger'
  // White pill on dark bg → "depress" on hover (slight darken to slate-200);
  // red pill darkens to a deeper red. Both follow the same hover convention so
  // tapping/hovering feels consistent across the app.
  const idleBg = isDanger ? '#ef4444' : palette.slate50
  const hoverBg = isDanger ? '#dc2626' : palette.slate200
  const textColor = isDanger ? '#ffffff' : palette.slate900

  return (
    <Pressable
      {...(Platform.OS === 'web' && webDomId ? ({ id: webDomId } as any) : {})}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={disabled ? { disabled: true } : undefined}
      {...hoverHandlers}
      style={({ pressed }) => ({
        height: 40,
        minWidth: 88,
        flex,
        paddingHorizontal: 16,
        borderRadius: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: isHovered ? hoverBg : idleBg,
        opacity: disabled ? 0.5 : pressed ? 0.88 : 1,
        ...(Platform.OS === 'web'
          ? ({
              cursor: disabled ? 'default' : 'pointer',
              transition: 'background-color 160ms ease, transform 160ms ease',
              transform: isHovered && !disabled ? 'translateY(-1px)' : 'translateY(0)',
            } as any)
          : null),
      })}
    >
      <Text fontSize={14} fontWeight="600" color={textColor}>
        {children}
      </Text>
    </Pressable>
  )
}
