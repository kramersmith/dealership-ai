import { useState, type ReactNode } from 'react'
import { Platform, View } from 'react-native'

interface HoverLiftFrameProps {
  children: ReactNode
  shadowColor: string
  borderRadius?: number
  interactive?: boolean
}

export function HoverLiftFrame({
  children,
  shadowColor,
  borderRadius = 12,
  interactive = true,
}: HoverLiftFrameProps) {
  const HoverView = View as any
  const [isHovered, setIsHovered] = useState(false)

  if (Platform.OS !== 'web') {
    return <>{children}</>
  }

  const style = {
    borderRadius,
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
