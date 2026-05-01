import type { ReactNode } from 'react'
import { Platform } from 'react-native'
import { XStack, YStack, Text } from 'tamagui'
import { palette } from '@/lib/theme/tokens'
import { DISPLAY_FONT_FAMILY } from '@/lib/constants'

interface CardTitleProps {
  children: string
  /** Lucide icon element. Rendered inside a tinted square tile when provided. */
  icon?: ReactNode
  /** Hex color used for the icon tile background tint and icon color. Defaults to emerald. */
  iconAccent?: string
  /** Right-aligned content. Defaults to the "AI · LIVE" tag. */
  right?: ReactNode
}

function hexToRgba(hex: string, alpha: number): string {
  if (hex.startsWith('rgba(') || hex.startsWith('rgb(')) {
    return hex
  }
  const trimmed = hex.replace('#', '')
  const expanded =
    trimmed.length === 3
      ? trimmed
          .split('')
          .map((c) => c + c)
          .join('')
      : trimmed.slice(0, 6)
  const r = parseInt(expanded.slice(0, 2), 16)
  const g = parseInt(expanded.slice(2, 4), 16)
  const b = parseInt(expanded.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Live-status badge green ("Updates after each reply"). */
const NO_ICON_TITLE_COLOR = 'rgba(110, 231, 183, 0.95)'

export function CardTitle({ children, icon, iconAccent, right }: CardTitleProps) {
  const accent = iconAccent ?? palette.copilotEmerald
  const tileBg = hexToRgba(accent, 0.1)
  const tileRing = hexToRgba(accent, 0.3)
  // Title matches the icon's accent when there is one; otherwise falls back to
  // the live-status emerald so unaccented cards still feel on-brand.
  const titleColor = icon ? accent : NO_ICON_TITLE_COLOR

  return (
    <XStack alignItems="center" justifyContent="space-between" gap={8}>
      <XStack alignItems="center" gap={8} flex={1} minWidth={0}>
        {icon ? (
          <YStack
            width={24}
            height={24}
            borderRadius={6}
            backgroundColor={tileBg}
            alignItems="center"
            justifyContent="center"
            flexShrink={0}
            // Source uses Tailwind `ring-1 ring-{accent}/30` (outline outside the
            // box). Match it via inset box-shadow on web; fallback to a border on
            // native so the tile still has its ring on iOS/Android.
            {...(Platform.OS === 'web'
              ? ({ style: { boxShadow: `inset 0 0 0 1px ${tileRing}` } } as any)
              : { borderWidth: 1, borderColor: tileRing })}
          >
            {icon}
          </YStack>
        ) : null}
        <Text
          fontSize={13}
          fontWeight="500"
          color={titleColor}
          flex={1}
          numberOfLines={1}
          letterSpacing={-0.1}
          fontFamily={DISPLAY_FONT_FAMILY}
        >
          {children}
        </Text>
      </XStack>
      {right ?? null}
    </XStack>
  )
}
