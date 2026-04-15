import { type ReactNode } from 'react'
import { Animated } from 'react-native'
import { XStack } from 'tamagui'
import { useIconEntrance } from '@/hooks/useAnimatedValue'
import { HeaderIconButton } from './HeaderIconButton'
import { ScrambleText } from './ScrambleText'

interface ScreenHeaderProps {
  /** Icon element for the left slot (e.g. <ChevronLeft />, <Settings />) */
  leftIcon: ReactNode
  /** Called when the left icon is pressed */
  onLeftPress: () => void
  /** Accessibility label for the left button */
  leftLabel?: string
  /** Header title text */
  title: string
  /** Key for ScrambleText — change to re-trigger the scramble animation */
  titleKey?: string
  /** Whether the scramble animation is active (default true) */
  scrambleActive?: boolean
  /** Icon element for the right slot (optional — renders a spacer if omitted) */
  rightIcon?: ReactNode
  /** Called when the right icon is pressed */
  onRightPress?: () => void
  /** Accessibility label for the right button */
  rightLabel?: string
  /** Trigger for the left icon entrance animation (e.g. isFocused). Default true. */
  iconTrigger?: boolean
}

export function ScreenHeader({
  leftIcon,
  onLeftPress,
  leftLabel = 'Navigate',
  title,
  titleKey,
  scrambleActive = true,
  rightIcon,
  onRightPress,
  rightLabel,
  iconTrigger = true,
}: ScreenHeaderProps) {
  const iconAnim = useIconEntrance(iconTrigger)

  return (
    <XStack
      paddingHorizontal="$4"
      paddingVertical="$3"
      alignItems="center"
      justifyContent="space-between"
      borderBottomWidth={1}
      borderBottomColor="$borderColor"
      backgroundColor="$backgroundStrong"
    >{[
      <HeaderIconButton key="hdr-left" onPress={onLeftPress} accessibilityLabel={leftLabel}><Animated.View
          style={{
            opacity: iconAnim.opacity,
            transform: [{ rotate: iconAnim.rotate }],
          }}
        >{leftIcon}</Animated.View></HeaderIconButton>,
      <ScrambleText
        key={titleKey ?? title}
        text={title}
        active={scrambleActive}
        containerStyle={{ flex: 1, minWidth: 0, alignItems: 'center' }}
        fontSize={18}
        fontWeight="700"
        color="$color"
        textAlign="center"
        numberOfLines={1}
      />,
      rightIcon && onRightPress ? (
        <HeaderIconButton key="hdr-right" onPress={onRightPress} accessibilityLabel={rightLabel ?? 'Action'}>{rightIcon}</HeaderIconButton>
      ) : (
        <XStack key="hdr-spacer" width={44} />
      ),
    ]}</XStack>
  )
}
