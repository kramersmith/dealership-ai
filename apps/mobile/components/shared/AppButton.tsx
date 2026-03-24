import { Button, type ButtonProps } from 'tamagui'
import { colors } from '@/lib/colors'

interface AppButtonProps extends ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
}

const variantStyles = {
  primary: {
    backgroundColor: colors.brand,
    color: 'white' as const,
    pressStyle: { backgroundColor: colors.brandPressed },
  },
  secondary: {
    backgroundColor: 'transparent',
    color: colors.brand as string,
    borderWidth: 1,
    borderColor: colors.brand,
    pressStyle: { backgroundColor: colors.brandSubtle },
  },
  ghost: {
    backgroundColor: 'transparent',
    color: '$color' as const,
    pressStyle: { backgroundColor: '$backgroundHover' },
  },
  danger: {
    backgroundColor: colors.danger,
    color: 'white' as const,
    pressStyle: { backgroundColor: colors.dangerPressed },
  },
}

export function AppButton({ variant = 'primary', ...props }: AppButtonProps) {
  const styles = variantStyles[variant]
  return (
    <Button
      size="$4"
      fontWeight="600"
      borderRadius="$2"
      {...styles}
      {...props}
    />
  )
}
