import { useState, type ReactNode } from 'react'
import { Platform, View, type ViewStyle } from 'react-native'

interface HoverLiftFrameProps {
  children: ReactNode
  shadowColor: string
  borderRadius?: number
  interactive?: boolean
  /** Merged into the outer web wrapper (e.g. width) so shadow matches the card box */
  layoutStyle?: ViewStyle
}

export function HoverLiftFrame({
  children,
  shadowColor,
  borderRadius = 12,
  interactive = true,
  layoutStyle,
}: HoverLiftFrameProps) {
  const HoverView = View as any
  const [isHovered, setIsHovered] = useState(false)

  if (Platform.OS !== 'web') {
    return <>{children}</>
  }

  const style = {
    borderRadius,
    ...(layoutStyle ?? {}),
    boxShadow: isHovered
      ? `0 4px 12px ${shadowColor}, 0 2px 6px ${shadowColor}`
      : `0 1px 3px ${shadowColor}, 0 1px 2px ${shadowColor}`,
    transform: [{ translateY: interactive && isHovered ? -2 : 0 }],
    transition: 'transform 0.2s ease, box-shadow 0.2s ease',
    cursor: interactive ? 'pointer' : 'default',
  } as any

  return interactive ? (
    <HoverView
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={style}
    >
      {children}
    </HoverView>
  ) : (
    <View style={style}>{children}</View>
  )
}
