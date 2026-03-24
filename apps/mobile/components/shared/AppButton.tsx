import { Button, type ButtonProps } from 'tamagui'
import type { ReactNode } from 'react'
import { colors } from '@/lib/colors'

interface AppButtonProps extends Omit<ButtonProps, 'variant'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  children?: ReactNode
}

const variantStyles = {
  primary: {
    button: {
      backgroundColor: colors.brand,
      pressStyle: { backgroundColor: colors.brandPressed },
    },
    text: { color: 'white' as const, fontWeight: '600' as const },
  },
  secondary: {
    button: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: colors.brand,
      pressStyle: { backgroundColor: colors.brandSubtle },
    },
    text: { color: colors.brand as string, fontWeight: '600' as const },
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
      backgroundColor: colors.danger,
      pressStyle: { backgroundColor: colors.dangerPressed },
    },
    text: { color: 'white' as const, fontWeight: '600' as const },
  },
}

export function AppButton({ variant = 'primary', children, ...props }: AppButtonProps) {
  const styles = variantStyles[variant]
  return (
    <Button size="$5" borderRadius="$2" {...styles.button} {...props}>
      <Button.Text {...styles.text}>{children}</Button.Text>
    </Button>
  )
}
