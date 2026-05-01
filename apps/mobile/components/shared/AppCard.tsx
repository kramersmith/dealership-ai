import { Platform, type ViewStyle } from 'react-native'
import { YStack, useTheme, useThemeName, type YStackProps } from 'tamagui'
import { palette } from '@/lib/theme/tokens'
import { HoverLiftFrame } from './HoverLiftFrame'

interface AppCardProps extends YStackProps {
  children: React.ReactNode
  /** Optional brand-colored top accent line */
  accent?: boolean
  /** Reduced padding for compact/secondary contexts */
  compact?: boolean
  /** Enable hover lift effect for interactive (tappable) cards */
  interactive?: boolean
  /**
   * Optional header slot — rendered inside the card with px-4 py-3 + bottom divider,
   * so the body still gets normal padding. Matches the source insight-card pattern.
   */
  header?: React.ReactNode
}

export function AppCard({
  children,
  accent = false,
  compact = false,
  interactive = false,
  header,
  ...props
}: AppCardProps) {
  const theme = useTheme()
  const themeName = useThemeName()
  const isCopilotChat = themeName === 'dark_copilot'
  const shadow = theme.shadowColor?.val ?? palette.overlay
  const cardRadius = isCopilotChat ? 16 : 12
  // Source uses border-white/10 but our backdrop-blur softens it visually —
  // bumping to 14% so the card edges read as crisply as the source's.
  const cardBorder = isCopilotChat ? 'rgba(255, 255, 255, 0.14)' : '$borderColor'
  const cardBackground = isCopilotChat ? palette.copilotFrostedRail : '$backgroundStrong'

  const { width, maxWidth, minWidth, alignSelf, ...restProps } = props

  const webSizesFrame =
    Platform.OS === 'web' &&
    (width !== undefined || maxWidth !== undefined || minWidth !== undefined)

  const hoverLayoutStyle: ViewStyle | undefined =
    webSizesFrame === true
      ? ({
          ...(width !== undefined ? { width } : {}),
          ...(maxWidth !== undefined ? { maxWidth } : {}),
          ...(minWidth !== undefined ? { minWidth } : {}),
          alignSelf: alignSelf ?? 'flex-start',
        } as ViewStyle)
      : undefined

  const headerNode = header ? (
    <YStack
      paddingHorizontal={16}
      paddingVertical={12}
      borderBottomWidth={1}
      borderBottomColor="rgba(255, 255, 255, 0.05)"
    >
      {header}
    </YStack>
  ) : null

  const bodyPaddingHorizontal = header ? 16 : compact ? 12 : 16
  const bodyPaddingVertical = header ? 16 : compact ? 12 : 16

  const card = (
    <YStack
      backgroundColor={cardBackground}
      borderRadius={cardRadius}
      borderWidth={1}
      borderColor={cardBorder}
      overflow="hidden"
      // accent is legacy — only rendered when no header slot is used
      borderTopWidth={!header && accent ? 2 : 1}
      borderTopColor={!header && accent ? '$brand' : cardBorder}
      {...(Platform.OS === 'web'
        ? ({
            style: {
              backdropFilter: isCopilotChat ? 'blur(20px) saturate(1.15)' : undefined,
              WebkitBackdropFilter: isCopilotChat ? 'blur(20px) saturate(1.15)' : undefined,
            },
          } as any)
        : {})}
      width={webSizesFrame ? '100%' : width}
      maxWidth={webSizesFrame ? '100%' : maxWidth}
      minWidth={webSizesFrame && minWidth !== undefined ? '100%' : minWidth}
      alignSelf={webSizesFrame ? undefined : alignSelf}
      {...restProps}
    >
      {headerNode}
      <YStack paddingHorizontal={bodyPaddingHorizontal} paddingVertical={bodyPaddingVertical}>
        {children}
      </YStack>
    </YStack>
  )

  if (Platform.OS === 'web') {
    return (
      <HoverLiftFrame
        shadowColor={shadow as string}
        interactive={interactive}
        layoutStyle={hoverLayoutStyle}
      >
        {card}
      </HoverLiftFrame>
    )
  }

  return card
}
