import { Platform } from 'react-native'
import { Button, type ButtonProps } from 'tamagui'
import type { ReactNode } from 'react'

interface AppButtonProps extends Omit<ButtonProps, 'variant'> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
  /** Modal / dense rows: caps height at 44px (still meets touch target). */
  compact?: boolean
  children?: ReactNode
}

const variantStyles = {
  primary: {
    button: {
      backgroundColor: '$brand',
      pressStyle: { backgroundColor: '$brandPressed' },
    },
    text: { color: '$white' as const, fontWeight: '600' as const },
  },
  secondary: {
    button: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: '$brand',
      pressStyle: { backgroundColor: '$brandSubtle' },
    },
    text: { color: '$brand' as string, fontWeight: '600' as const },
  },
  /** Muted secondary action with visible chrome (e.g. skip / reject next to primary). */
  outline: {
    button: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: '$borderColor',
      pressStyle: { backgroundColor: '$backgroundHover' },
    },
    text: { color: '$color' as const, fontWeight: '600' as const },
  },
  ghost: {
    button: {
      backgroundColor: 'transparent',
      pressStyle: { backgroundColor: '$backgroundHover' },
    },
    text: { color: '$color' as const, fontWeight: '600' as const },
  },
  danger: {
    button: {
      backgroundColor: '$danger',
      pressStyle: { backgroundColor: '$dangerPressed' },
    },
    text: { color: '$white' as const, fontWeight: '600' as const },
  },
}

export function AppButton({ variant = 'primary', compact, children, ...props }: AppButtonProps) {
  const styles = variantStyles[variant]
  const { accessibilityLabel, size: sizeProp, ...buttonProps } = props
  const size = sizeProp ?? (compact ? '$3' : '$5')
  const compactChrome = compact
    ? ({
        height: 44,
        maxHeight: 44,
        paddingVertical: '$1',
      } as const)
    : {}
  return (
    <Button
      size={size}
      borderRadius="$2"
      {...styles.button}
      {...compactChrome}
      {...buttonProps}
      {...(accessibilityLabel
        ? Platform.OS === 'web'
          ? ({ 'aria-label': accessibilityLabel } as any)
          : { accessibilityLabel }
        : null)}
    >
      <Button.Text
        {...styles.text}
        {...(compact ? ({ fontSize: 14, lineHeight: 18 } as const) : {})}
      >
        {children}
      </Button.Text>
    </Button>
  )
}
