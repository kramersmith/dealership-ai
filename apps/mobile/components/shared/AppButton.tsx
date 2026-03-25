import { Button, type ButtonProps } from 'tamagui'
import type { ReactNode } from 'react'

interface AppButtonProps extends Omit<ButtonProps, 'variant'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  children?: ReactNode
}

const variantStyles = {
  primary: {
    button: {
      backgroundColor: '$brand',
      pressStyle: { backgroundColor: '$brandPressed' },
    },
    text: { color: 'white' as const, fontWeight: '600' as const },
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
