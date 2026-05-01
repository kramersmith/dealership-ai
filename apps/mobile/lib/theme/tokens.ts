/**
 * Raw color palette — the single source of truth for all color values.
 *
 * Use `palette` when you need a raw hex string (e.g. StyleSheet.create,
 * Animated.View style, RN Modal backgroundColor).
 *
 * Use `tokenColors` to register these as Tamagui tokens so components
 * can reference them via `$brand`, `$danger`, etc.
 */

export const palette = {
  brand: '#2D88FF',
  brandPressed: '#1877F2',
  brandLight: '#4599FF',
  brandSubtle: '#263240',
  /** Light-mode equivalent of brandSubtle — used for insights strip brand wash. */
  brandSubtleLight: '#E5EEF8',
  /** Brighter finish-flash peaks for the insights strip emphasis interpolation. */
  brandFinishPeakDark: '#364E6B',
  brandFinishPeakLight: '#C8DDF8',

  positive: '#22C55E',
  warning: '#EAB308',
  danger: '#EF4444',
  dangerPressed: '#DC2626',
  /** Lighter red used for inline icon/text accents on dark surfaces (red-400). */
  dangerLight: '#f87171',
  /** Cyan-400 — comparison-card accent. */
  accentCyan: '#22d3ee',
  /** Blue-400 — briefing-card neutral accent. */
  accentBlue: '#60a5fa',
  /** Violet glow for the assistant avatar (purple-400 shadow + purple-600 ring stop). */
  copilotAssistantGlow: '#a855f7',
  copilotAssistantGlowDeep: '#7c3aed',
  copilotAssistantHighlight: '#ede9fe',

  /** For text/icons on colored surfaces (status pills, brand buttons). */
  white: '#FFFFFF',
  whiteTint10: 'rgba(255,255,255,0.1)',
  whiteTint12: 'rgba(255,255,255,0.12)',
  whiteTint20: 'rgba(255,255,255,0.2)',
  whiteTint22: 'rgba(255,255,255,0.22)',
  whiteTint55: 'rgba(255,255,255,0.55)',
  whiteTint85: 'rgba(255,255,255,0.85)',

  overlay: 'rgba(0,0,0,0.6)',
  shadowOverlay: 'rgba(0,0,0,0.3)',

  /** Buyer copilot — slate-950 base, emerald + violet accents (Haggle-style reference). */
  copilotBackground: '#030712',
  copilotSurface: 'rgba(15, 23, 42, 0.72)',
  copilotSurfaceSolid: '#0f172a',
  copilotBorder: 'rgba(255, 255, 255, 0.1)',
  copilotEmerald: '#34d399',
  copilotEmeraldPressed: '#10b981',
  copilotEmeraldMuted: 'rgba(16, 185, 129, 0.15)',
  copilotPurple: '#c4b5fd',
  copilotPurpleMuted: 'rgba(168, 85, 247, 0.2)',
  /** Caution tier — sits between emerald (good) and red (critical). Uses
   *  amber-400; muted variant is the tinted surface for warning chrome. */
  copilotWarning: '#fbbf24',
  copilotWarningPressed: '#f59e0b',
  copilotWarningMuted: 'rgba(251, 191, 36, 0.15)',

  /**
   * Ghost-pressable surface scale — used by every neutral icon button + pill
   * in the new design (HeaderIconButton, ModalGhostButton, FilterChip,
   * InsightsToggleButton dropdown rows, etc.). Idle ↔ hover pair for both
   * the surface fill and the 1px border, plus a half-step `Subtle` value
   * for hovered list rows / dividers. Single source of truth so the
   * scale stays consistent if it ever shifts.
   */
  ghostBg: 'rgba(255, 255, 255, 0.04)',
  ghostBgSubtle: 'rgba(255, 255, 255, 0.06)',
  ghostBgHover: 'rgba(255, 255, 255, 0.08)',
  ghostBorder: 'rgba(255, 255, 255, 0.10)',
  ghostBorderHover: 'rgba(255, 255, 255, 0.20)',

  /**
   * Slate text scale used across the new design. Mirrors Tailwind's slate
   * tokens; these are also wired into the Tamagui theme as $color5–$color12
   * but exposed here so style objects (`StyleSheet.create`, inline JS
   * styles) can reference them without a `useTheme()` call.
   */
  slate950: '#020617',
  slate900: '#0f172a',
  slate800: '#1e293b',
  slate700: '#334155',
  slate600: '#475569',
  slate500: '#64748b',
  slate400: '#94a3b8',
  slate300: '#cbd5e1',
  slate200: '#e2e8f0',
  slate100: '#f1f5f9',
  slate50: '#f8fafc',

  /** Emerald tint scale — for emerald-accented chrome (Insights pill, decoded
   *  vehicle block, focus rings). */
  copilotEmeraldTint10: 'rgba(16, 185, 129, 0.10)',
  copilotEmeraldTint18: 'rgba(16, 185, 129, 0.18)',
  copilotEmeraldBorder25: 'rgba(52, 211, 153, 0.25)',
  copilotEmeraldBorder30: 'rgba(52, 211, 153, 0.30)',
  copilotEmeraldBorder40: 'rgba(52, 211, 153, 0.40)',
  copilotEmeraldBorder55: 'rgba(52, 211, 153, 0.55)',
  /** Emerald-200 — high-contrast text on emerald-tinted surfaces (Insights pill label). */
  copilotEmerald200: '#a7f3d0',
  /** Emerald-200 with alpha — analyzing-state preview text on slate panels. */
  copilotEmerald200Tint95: 'rgba(110, 231, 183, 0.95)',
  /** Source: bg-slate-800/60 + border-white/5 (assistant). */
  copilotChatAssistantBg: 'rgba(30, 41, 59, 0.6)',
  copilotChatAssistantBorder: 'rgba(255, 255, 255, 0.05)',
  copilotAssistantAvatar: '#a78bfa',
  /** Source: bg-emerald-500/15 + border-emerald-400/20 (user). */
  copilotChatUserBg: 'rgba(16, 185, 129, 0.15)',
  copilotChatUserBorder: 'rgba(52, 211, 153, 0.20)',
  copilotChatUserText: '#ecfdf5',
  /** Main frosted chat column (slightly lifted from page bg). */
  copilotFrostedPanel: 'rgba(15, 23, 42, 0.9)',
  /** Frosted-rail bg — slightly translucent slate-900 used by FrostedChatRail
   *  and the CopilotTopNav pill-row backdrop. */
  copilotFrostedRail: 'rgba(15, 23, 42, 0.6)',
  /** Mobile insights sheet bg — denser frost than the chat rail. */
  copilotInsightsMobileSheet: 'rgba(15, 23, 42, 0.92)',
  /** Desktop insights side-panel bg — most translucent of the frost trio. */
  copilotInsightsDesktopPanel: 'rgba(2, 6, 23, 0.40)',
  /** Filter-chip dropdown menu bg (very opaque slate-900). */
  copilotMenuFrost: 'rgba(15, 23, 42, 0.95)',
  /** Soft slate-700 wash — secondary banner inside the composer (edit-mode). */
  copilotComposerBannerBg: 'rgba(51, 65, 85, 0.45)',
  /** Slightly stronger 1px hairline used by the chat composer top border. */
  copilotComposerHairline: 'rgba(255, 255, 255, 0.16)',
  /** Translucent slate-950 wash — used for floating chrome over scrolling
   *  content (e.g. the chat-list search row backdrop) where heavier
   *  backdrop blur carries the "frosted" feel. */
  copilotChromeFloat: 'rgba(3, 7, 18, 0.55)',
  /** Hero “ACTIVE NEGOTIATION” pill. */
  copilotBadgeBg: 'rgba(124, 58, 237, 0.32)',
  copilotBadgeBorder: 'rgba(167, 139, 250, 0.4)',
  copilotBadgeText: '#ede9fe',
  copilotBadgeDot: '#c4b5fd',
  /** Composer tray / dock — darker than frosted rail. */
  copilotChromeTray: 'rgba(3, 7, 18, 0.96)',
  copilotComposerField: 'rgba(2, 6, 23, 0.92)',
  copilotComposerFieldBorder: 'rgba(255, 255, 255, 0.1)',
  copilotShadowDeep: 'rgba(0, 0, 0, 0.55)',
} as const

/** Merged into createTamagui tokens.color so `$brand` etc. resolve in Tamagui props. */
export const tokenColors = {
  brand: palette.brand,
  brandPressed: palette.brandPressed,
  brandLight: palette.brandLight,
  brandSubtle: palette.brandSubtle,
  positive: palette.positive,
  warning: palette.warning,
  danger: palette.danger,
  dangerPressed: palette.dangerPressed,
  white: palette.white,
} as const
