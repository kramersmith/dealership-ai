import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from 'react-native'
import { Sparkles } from '@tamagui/lucide-icons'
import { Text, XStack, YStack, useTheme } from 'tamagui'
import { HeaderIconButton } from '@/components/shared'
import { useIconEntrance } from '@/hooks/useAnimatedValue'
import {
  useBreathingPulseOverlay,
  useScaleBorderFinishFlash,
  useSignatureEntranceAnimation,
} from '@/hooks/useInsightsAnimations'
import type { DesktopPanelShellState } from '@/hooks/useDesktopInsightsShell'
import type { AiCardKind, InsightsUpdateMode } from '@/lib/types'
import { palette } from '@/lib/theme/tokens'
import { InsightPanelPreviewIcons } from './InsightPanelPreviewIcons'

const DOCK_PREVIEW_HOLD_MS = 1000
const DOCK_EXPAND_WIDTH_MS = 380
const DOCK_COLLAPSE_WIDTH_MS = 420

type DockPostUpdatingPhase = 'none' | 'hold' | 'collapse'

function DockAnimatedIcon({ color = '$color' }: { color?: string }) {
  const entrance = useIconEntrance(true)

  return (
    <Animated.View
      style={{
        opacity: entrance.opacity,
        transform: [{ rotate: entrance.rotate }],
      }}
    >
      <Sparkles size={16} color={color} />
    </Animated.View>
  )
}

interface DesktopInsightsDockControlProps {
  shellState: DesktopPanelShellState
  /** Highest-priority deal/panel headline for the collapsed updating pill. */
  collapsedPrimaryText: string
  /** Deduped panel kinds for a compact icon strip (matches visible panel order). */
  panelIconKinds?: readonly AiCardKind[]
  /** Full VoiceOver / TalkBack description including headline and panel breadth. */
  collapsedPreviewAccessibilityLabel: string
  insightsUpdateMode: InsightsUpdateMode
  /** When true, skip motion on the idle launcher pill. */
  prefersReducedMotion: boolean
  launcherOpacity: Animated.Value
  launcherTranslateX: Animated.Value
  topOffsetPx?: number
  rightOffsetPx?: number
  onExpandPress: () => void
}

export function DesktopInsightsDockControl({
  shellState,
  collapsedPrimaryText,
  panelIconKinds = [],
  collapsedPreviewAccessibilityLabel,
  insightsUpdateMode,
  prefersReducedMotion,
  launcherOpacity,
  launcherTranslateX,
  topOffsetPx = 8,
  rightOffsetPx = 12,
  onExpandPress,
}: DesktopInsightsDockControlProps) {
  const theme = useTheme()
  const shadowColor = theme.shadowColor?.val ?? palette.shadowOverlay
  const backgroundStrongColor = (theme.backgroundStrong?.val as string) ?? '#242526'
  const resolvedBorderColor = (theme.borderColor?.val as string) ?? '#3E4042'
  const brandSubtleBackground = (theme.brandSubtle?.val as string) ?? palette.brandSubtle

  const {
    scaleAnim: dockPillScaleAnim,
    borderWidthAnim: dockPillBorderWidthAnim,
    trigger: triggerDockFinishFlash,
    stop: stopDockFinishFlash,
  } = useScaleBorderFinishFlash({
    scaleTo: 1.12,
    borderWidthTo: 2.5,
    scaleUsesNativeDriver: false, // shares a node with animated width/backgroundColor
    prefersReducedMotion,
  })

  const dockCollapseWidthAnim = useRef(new Animated.Value(320)).current
  const dockCollapseAnimRef = useRef<Animated.CompositeAnimation | null>(null)
  const widePillWidthRef = useRef(320)
  const dockHoldSeqRef = useRef(0)
  const prevShellForDockRef = useRef<DesktopPanelShellState | null>(null)

  const [postUpdatingPhase, setPostUpdatingPhase] = useState<DockPostUpdatingPhase>('none')
  /** Intrinsic width of the wide preview row, measured offscreen once per hold (motion path). */
  const [holdIntrinsicWidth, setHoldIntrinsicWidth] = useState<number | null>(null)
  const prevPostUpdatingPhaseRef = useRef<DockPostUpdatingPhase>('none')
  const holdExpandRunIdRef = useRef(0)
  const holdAfterExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const idleLauncherSignature = useMemo(() => {
    if (shellState !== 'collapsed_idle' || postUpdatingPhase !== 'none') return ''
    return `${collapsedPrimaryText}|${panelIconKinds.join(',')}|${insightsUpdateMode}`
  }, [collapsedPrimaryText, insightsUpdateMode, panelIconKinds, postUpdatingPhase, shellState])

  const dockPulseOverlayAnim = useBreathingPulseOverlay(
    shellState === 'collapsed_updating',
    prefersReducedMotion
  )

  const {
    opacityAnim: dockPillContentOpacityAnim,
    translateYAnim: dockPillContentTranslateYAnim,
    suppressNext: suppressNextDockEntrance,
  } = useSignatureEntranceAnimation(idleLauncherSignature, prefersReducedMotion, {
    useNativeDriver: false,
  })

  const stopDockCollapse = useCallback(() => {
    dockCollapseAnimRef.current?.stop()
    dockCollapseAnimRef.current = null
  }, [])

  const runDockFinishFlash = useCallback(() => {
    // The finish flash already plays the role of an entrance; suppress the
    // next idle-signature entrance so content doesn't double-animate.
    suppressNextDockEntrance()
    triggerDockFinishFlash()
  }, [suppressNextDockEntrance, triggerDockFinishFlash])

  useEffect(() => {
    if (shellState === 'hidden' || shellState === 'expanded') {
      stopDockCollapse()
      dockHoldSeqRef.current += 1
      setHoldIntrinsicWidth(null)
      setPostUpdatingPhase('none')
      stopDockFinishFlash()
      prevShellForDockRef.current = shellState
      return
    }

    const prev = prevShellForDockRef.current
    prevShellForDockRef.current = shellState

    if (shellState === 'collapsed_updating') {
      dockHoldSeqRef.current += 1
      stopDockCollapse()
      setHoldIntrinsicWidth(null)
      setPostUpdatingPhase('none')
    }

    if (shellState === 'collapsed_idle' && prev === 'collapsed_updating') {
      dockHoldSeqRef.current += 1
      setPostUpdatingPhase('hold')
    }
  }, [shellState, stopDockCollapse, stopDockFinishFlash])

  useLayoutEffect(() => {
    const prev = prevPostUpdatingPhaseRef.current
    prevPostUpdatingPhaseRef.current = postUpdatingPhase
    if (postUpdatingPhase === 'hold' && prev !== 'hold') {
      setHoldIntrinsicWidth(null)
      if (!prefersReducedMotion) {
        dockCollapseWidthAnim.setValue(44)
      }
    }
    if (postUpdatingPhase === 'none') {
      setHoldIntrinsicWidth(null)
    }
  }, [dockCollapseWidthAnim, postUpdatingPhase, prefersReducedMotion])

  /** Reduced motion: hold wide preview briefly, then skip collapse and finish. */
  useEffect(() => {
    if (postUpdatingPhase !== 'hold' || !prefersReducedMotion) {
      return
    }

    const seq = dockHoldSeqRef.current
    const timer = setTimeout(() => {
      if (dockHoldSeqRef.current !== seq) return
      setPostUpdatingPhase('none')
      runDockFinishFlash()
    }, DOCK_PREVIEW_HOLD_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [postUpdatingPhase, prefersReducedMotion, runDockFinishFlash])

  /** Measure intrinsic width, expand clip 44 → W, dwell, then enter collapse phase. */
  useEffect(() => {
    if (postUpdatingPhase !== 'hold' || prefersReducedMotion || holdIntrinsicWidth == null) {
      return
    }

    const seq = dockHoldSeqRef.current
    const runId = ++holdExpandRunIdRef.current

    stopDockCollapse()
    dockCollapseWidthAnim.setValue(44)

    const expand = Animated.timing(dockCollapseWidthAnim, {
      toValue: holdIntrinsicWidth,
      duration: DOCK_EXPAND_WIDTH_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    })
    dockCollapseAnimRef.current = expand

    expand.start(({ finished }) => {
      dockCollapseAnimRef.current = null
      if (!finished || runId !== holdExpandRunIdRef.current || dockHoldSeqRef.current !== seq) {
        return
      }
      widePillWidthRef.current = holdIntrinsicWidth

      if (holdAfterExpandTimerRef.current) clearTimeout(holdAfterExpandTimerRef.current)
      holdAfterExpandTimerRef.current = setTimeout(() => {
        holdAfterExpandTimerRef.current = null
        if (dockHoldSeqRef.current !== seq) return
        setPostUpdatingPhase('collapse')
      }, DOCK_PREVIEW_HOLD_MS)
    })

    return () => {
      expand.stop()
      if (holdAfterExpandTimerRef.current) {
        clearTimeout(holdAfterExpandTimerRef.current)
        holdAfterExpandTimerRef.current = null
      }
    }
  }, [
    dockCollapseWidthAnim,
    holdIntrinsicWidth,
    postUpdatingPhase,
    prefersReducedMotion,
    stopDockCollapse,
  ])

  /** Collapse wide preview clip W → 44, then settle on icon + finish flash. */
  useEffect(() => {
    if (postUpdatingPhase !== 'collapse' || prefersReducedMotion) {
      return
    }

    const seq = dockHoldSeqRef.current

    requestAnimationFrame(() => {
      if (dockHoldSeqRef.current !== seq) return
      stopDockCollapse()
      const w = Math.max(44, widePillWidthRef.current)
      dockCollapseWidthAnim.setValue(w)

      const collapse = Animated.timing(dockCollapseWidthAnim, {
        toValue: 44,
        duration: DOCK_COLLAPSE_WIDTH_MS,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: false,
      })
      dockCollapseAnimRef.current = collapse
      collapse.start(({ finished }) => {
        dockCollapseAnimRef.current = null
        if (!finished || dockHoldSeqRef.current !== seq) return
        setPostUpdatingPhase('none')
        runDockFinishFlash()
      })
    })

    return () => {
      stopDockCollapse()
    }
  }, [
    dockCollapseWidthAnim,
    postUpdatingPhase,
    prefersReducedMotion,
    runDockFinishFlash,
    stopDockCollapse,
  ])

  const onWidePillLayout = useCallback((e: { nativeEvent: { layout: { width: number } } }) => {
    widePillWidthRef.current = Math.max(120, Math.ceil(e.nativeEvent.layout.width))
  }, [])

  const showWidePreviewPill =
    shellState === 'collapsed_idle' &&
    (postUpdatingPhase === 'hold' || postUpdatingPhase === 'collapse')

  if (shellState === 'hidden') {
    return null
  }

  if (shellState === 'expanded') return null

  const widePreviewPillInner = (
    <XStack
      position="relative"
      overflow="hidden"
      alignItems="center"
      gap="$2.5"
      height={44}
      justifyContent="center"
      paddingHorizontal="$3"
      paddingVertical="$2"
      backgroundColor="$backgroundStrong"
      borderRadius="$5"
      borderWidth={1}
      borderColor="$borderColor"
      onLayout={onWidePillLayout}
      {...(Platform.OS === 'web'
        ? {
            style: {
              boxShadow: `0 8px 18px ${shadowColor}`,
            },
          }
        : null)}
    >
      <DockAnimatedIcon color={insightsUpdateMode === 'paused' ? '$placeholderColor' : '$brand'} />
      <XStack
        flex={1}
        minWidth={0}
        alignItems="center"
        gap="$1"
        flexShrink={1}
        maxWidth={panelIconKinds.length > 0 ? 320 : 420}
      >
        {collapsedPrimaryText.trim().length > 0 ? (
          <Text
            fontSize={12}
            fontWeight="600"
            color="$color"
            numberOfLines={1}
            flexShrink={1}
            minWidth={0}
          >
            {collapsedPrimaryText}
          </Text>
        ) : (
          <Text fontSize={12} fontWeight="600" color="$placeholderColor" numberOfLines={1}>
            Insights
          </Text>
        )}
      </XStack>
      {panelIconKinds.length > 0 ? <InsightPanelPreviewIcons kinds={panelIconKinds} /> : null}
      <Text fontSize={11} color="$placeholderColor">
        {insightsUpdateMode === 'paused' ? 'Paused' : 'Live'}
      </Text>
    </XStack>
  )

  const content =
    shellState === 'collapsed_updating' ? (
      <HeaderIconButton
        onPress={onExpandPress}
        accessibilityLabel={collapsedPreviewAccessibilityLabel}
      >
        <Animated.View
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            overflow: 'hidden',
            backgroundColor: brandSubtleBackground,
            borderWidth: 1,
            borderColor: resolvedBorderColor,
            ...(Platform.OS === 'web'
              ? ({
                  boxShadow: `0 8px 18px ${shadowColor}`,
                } as any)
              : {
                  shadowColor,
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.22,
                  shadowRadius: 12,
                  elevation: 6,
                }),
          }}
        >
          {!prefersReducedMotion ? (
            <Animated.View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFillObject,
                {
                  borderRadius: 10,
                  backgroundColor: palette.brand,
                  opacity: dockPulseOverlayAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.07, 0.24],
                  }),
                },
              ]}
            />
          ) : null}
          <DockAnimatedIcon color="$brand" />
        </Animated.View>
      </HeaderIconButton>
    ) : shellState === 'collapsed_idle' && postUpdatingPhase === 'none' ? (
      <HeaderIconButton
        onPress={onExpandPress}
        accessibilityLabel={collapsedPreviewAccessibilityLabel}
      >
        <Animated.View
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: backgroundStrongColor,
            borderWidth: dockPillBorderWidthAnim,
            borderColor: resolvedBorderColor,
            opacity: dockPillContentOpacityAnim,
            transform: [
              { scale: dockPillScaleAnim },
              { translateY: dockPillContentTranslateYAnim },
            ],
            ...(Platform.OS === 'web'
              ? ({
                  boxShadow: `0 8px 18px ${shadowColor}`,
                } as any)
              : {
                  shadowColor,
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.22,
                  shadowRadius: 12,
                  elevation: 6,
                }),
          }}
        >
          <DockAnimatedIcon />
        </Animated.View>
      </HeaderIconButton>
    ) : showWidePreviewPill ? (
      <Pressable
        onPress={onExpandPress}
        accessibilityRole="button"
        accessibilityLabel={collapsedPreviewAccessibilityLabel}
        style={({ pressed }) => ({
          alignSelf: 'flex-start',
          minHeight: 44,
          opacity: pressed ? 0.96 : 1,
          transform: [{ scale: pressed ? 0.995 : 1 }],
          backgroundColor: 'transparent',
          borderWidth: 0,
          borderColor: 'transparent',
          ...(Platform.OS === 'web'
            ? {
                outlineWidth: 0,
                boxShadow: 'none',
                appearance: 'none',
                cursor: 'pointer',
              }
            : null),
        })}
      >
        {prefersReducedMotion ? (
          widePreviewPillInner
        ) : (
          <Animated.View
            style={{
              width: dockCollapseWidthAnim,
              overflow: 'hidden',
              borderRadius: 10,
              alignSelf: 'flex-start',
            }}
          >
            {widePreviewPillInner}
          </Animated.View>
        )}
      </Pressable>
    ) : null

  const widePreviewMeasureLayer =
    showWidePreviewPill && !prefersReducedMotion && holdIntrinsicWidth === null ? (
      <View
        pointerEvents="none"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        collapsable={false}
        style={{ position: 'absolute', left: -12000, top: 0, opacity: 0 }}
      >
        <View
          collapsable={false}
          onLayout={(e) => {
            const w = Math.max(120, Math.ceil(e.nativeEvent.layout.width))
            setHoldIntrinsicWidth(w)
          }}
        >
          {widePreviewPillInner}
        </View>
      </View>
    ) : null

  return (
    <YStack
      position="absolute"
      top={topOffsetPx}
      right={rightOffsetPx}
      zIndex={4}
      style={{ pointerEvents: 'box-none' } as any}
    >
      {widePreviewMeasureLayer}
      <Animated.View
        style={{
          opacity: launcherOpacity,
          transform: [{ translateX: launcherTranslateX }],
        }}
      >
        {content}
      </Animated.View>
    </YStack>
  )
}
