import { useState, useCallback, useRef } from 'react'
import { TouchableOpacity, Animated, TextInput, ActivityIndicator, Easing } from 'react-native'
import { YStack, XStack, Text, useTheme } from 'tamagui'
import { Search, FileText, MapPin, ScanLine } from '@tamagui/lucide-icons'
import { AppCard } from '@/components/shared'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import type { BuyerContext } from '@/lib/types'
import { useFadeIn, useSlideIn, useFocusBorder } from '@/hooks/useAnimatedValue'
import { normalizeVinCandidate } from '@/stores/chatStore'

interface ContextPickerProps {
  onSelect: (context: BuyerContext) => void
  onVinSubmit: (vin: string) => Promise<void>
}

const CONTEXT_OPTIONS: {
  context: BuyerContext
  label: string
  subtitle: string
  Icon: typeof Search
}[] = [
  {
    context: 'researching',
    label: 'Researching',
    subtitle: 'Looking at cars, comparing prices',
    Icon: Search,
  },
  {
    context: 'reviewing_deal',
    label: 'Have a deal to review',
    subtitle: 'Got a quote or offer I want to check',
    Icon: FileText,
  },
  {
    context: 'at_dealership',
    label: 'At the dealership',
    subtitle: "I'm here right now and need help",
    Icon: MapPin,
  },
]

function ContextOption({
  context,
  label,
  subtitle,
  Icon,
  index,
  onSelect,
}: {
  context: BuyerContext
  label: string
  subtitle: string
  Icon: typeof Search
  index: number
  onSelect: (context: BuyerContext) => void
}) {
  const { opacity, translateY } = useSlideIn(300, index * 80)

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <TouchableOpacity onPress={() => onSelect(context)} activeOpacity={0.7}>
        <AppCard interactive minHeight={64} padding="$4">
          <XStack alignItems="center" gap="$3">
            <YStack
              width={40}
              height={40}
              borderRadius="$2"
              backgroundColor="$brandSubtle"
              alignItems="center"
              justifyContent="center"
            >
              <Icon size={20} color="$brand" />
            </YStack>
            <YStack flex={1} gap="$1">
              <Text fontSize={15} fontWeight="600" color="$color">
                {label}
              </Text>
              <Text fontSize={13} color="$placeholderColor">
                {subtitle}
              </Text>
            </YStack>
          </XStack>
        </AppCard>
      </TouchableOpacity>
    </Animated.View>
  )
}

// ─── VIN Entry — Choreographed Transition ───

const EASE_OUT = Easing.out(Easing.cubic)
const EASE_IN = Easing.in(Easing.cubic)

// Exit timing
const EXIT_TITLE_MS = 180
const EXIT_SUBTITLE_DELAY = 50
const EXIT_SUBTITLE_MS = 160

// Enter timing
const ENTER_DELAY = 60 // pause between exit and enter
const ENTER_LABEL_MS = 200
const ENTER_INPUT_DELAY = 60
const ENTER_INPUT_MS = 250

// Motion distance
const SLIDE_PX = 8

function VinEntry({
  onSubmit,
  index,
}: {
  onSubmit: (vin: string) => Promise<void>
  index: number
}) {
  const theme = useTheme()
  const inputRef = useRef<TextInput>(null)
  const [expanded, setExpanded] = useState(false)
  const [vinInput, setVinInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { opacity, translateY } = useSlideIn(300, index * 80)

  // Exit: title and subtitle each have opacity + translateY
  const exitTitleOpacity = useRef(new Animated.Value(1)).current
  const exitTitleY = useRef(new Animated.Value(0)).current
  const exitSubOpacity = useRef(new Animated.Value(1)).current
  const exitSubY = useRef(new Animated.Value(0)).current

  // Enter: label and input row each have opacity + translateY
  const enterLabelOpacity = useRef(new Animated.Value(0)).current
  const enterLabelY = useRef(new Animated.Value(SLIDE_PX)).current
  const enterInputOpacity = useRef(new Animated.Value(0)).current
  const enterInputY = useRef(new Animated.Value(SLIDE_PX)).current

  // Icon pulse
  const iconScale = useRef(new Animated.Value(1)).current

  const handleExpand = useCallback(() => {
    if (expanded) return

    // 1. Icon pulse
    Animated.sequence([
      Animated.timing(iconScale, {
        toValue: 1.08,
        duration: 100,
        easing: EASE_OUT,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(iconScale, {
        toValue: 1,
        duration: 120,
        easing: EASE_IN,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]).start()

    // 2. Staggered exit: title slides up + fades, subtitle follows
    Animated.parallel([
      // Title exits
      Animated.timing(exitTitleOpacity, {
        toValue: 0,
        duration: EXIT_TITLE_MS,
        easing: EASE_IN,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(exitTitleY, {
        toValue: -SLIDE_PX,
        duration: EXIT_TITLE_MS,
        easing: EASE_IN,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      // Subtitle exits with delay
      Animated.timing(exitSubOpacity, {
        toValue: 0,
        duration: EXIT_SUBTITLE_MS,
        delay: EXIT_SUBTITLE_DELAY,
        easing: EASE_IN,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(exitSubY, {
        toValue: -SLIDE_PX,
        duration: EXIT_SUBTITLE_MS,
        delay: EXIT_SUBTITLE_DELAY,
        easing: EASE_IN,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]).start(({ finished }) => {
      if (!finished) return

      // 3. Swap content
      setExpanded(true)

      // 4. Staggered enter after brief pause
      const totalEnterDelay = ENTER_DELAY
      requestAnimationFrame(() => {
        Animated.parallel([
          // Label enters
          Animated.timing(enterLabelOpacity, {
            toValue: 1,
            duration: ENTER_LABEL_MS,
            delay: totalEnterDelay,
            easing: EASE_OUT,
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
          Animated.timing(enterLabelY, {
            toValue: 0,
            duration: ENTER_LABEL_MS,
            delay: totalEnterDelay,
            easing: EASE_OUT,
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
          // Input row enters with stagger
          Animated.timing(enterInputOpacity, {
            toValue: 1,
            duration: ENTER_INPUT_MS,
            delay: totalEnterDelay + ENTER_INPUT_DELAY,
            easing: EASE_OUT,
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
          Animated.timing(enterInputY, {
            toValue: 0,
            duration: ENTER_INPUT_MS,
            delay: totalEnterDelay + ENTER_INPUT_DELAY,
            easing: EASE_OUT,
            useNativeDriver: USE_NATIVE_DRIVER,
          }),
        ]).start(() => {
          inputRef.current?.focus()
        })
      })
    })
  }, [
    expanded,
    iconScale,
    exitTitleOpacity,
    exitTitleY,
    exitSubOpacity,
    exitSubY,
    enterLabelOpacity,
    enterLabelY,
    enterInputOpacity,
    enterInputY,
  ])

  const handleSubmit = useCallback(async () => {
    const normalized = normalizeVinCandidate(vinInput)
    if (!normalized) {
      setError('Enter a valid 17-character VIN')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(normalized)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to decode VIN')
    } finally {
      setSubmitting(false)
    }
  }, [vinInput, onSubmit])

  const brandColor = theme.brand?.val as string
  const textColor = theme.color?.val as string
  const borderColor = theme.borderColor?.val as string
  const borderColorHover = theme.borderColorHover?.val as string
  const bgColor = theme.backgroundStrong?.val as string
  const mutedColor = theme.placeholderColor?.val as string

  const focusBorder = useFocusBorder(borderColor, borderColorHover)

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <TouchableOpacity onPress={handleExpand} activeOpacity={0.7} disabled={expanded}>
        <AppCard interactive={!expanded} minHeight={64} padding="$4">
          <XStack alignItems="center" gap="$3">
            <Animated.View style={{ transform: [{ scale: iconScale }] }}>
              <YStack
                width={40}
                height={40}
                borderRadius="$2"
                backgroundColor="$brandSubtle"
                alignItems="center"
                justifyContent="center"
              >
                <ScanLine size={20} color="$brand" />
              </YStack>
            </Animated.View>
            <YStack flex={1} position="relative">
              {/* Expanded: input content in flow */}
              {expanded && (
                <YStack gap="$2">
                  <Animated.View
                    style={{ opacity: enterLabelOpacity, transform: [{ translateY: enterLabelY }] }}
                  >
                    <Text fontSize={13} fontWeight="600" color="$color">
                      Paste your VIN
                    </Text>
                  </Animated.View>
                  <Animated.View
                    style={{ opacity: enterInputOpacity, transform: [{ translateY: enterInputY }] }}
                  >
                    <XStack gap="$2">
                      <Animated.View
                        style={{
                          flex: 1,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: focusBorder.borderColor,
                          backgroundColor: bgColor,
                          overflow: 'hidden',
                        }}
                      >
                        <TextInput
                          ref={inputRef}
                          style={
                            {
                              height: 40,
                              color: textColor,
                              paddingHorizontal: 12,
                              fontSize: 14,
                              fontFamily: 'Inter',
                              outlineWidth: 0,
                            } as any
                          }
                          value={vinInput}
                          onChangeText={(text) => {
                            setVinInput(text.toUpperCase())
                            if (error) setError(null)
                          }}
                          onFocus={focusBorder.onFocus}
                          onBlur={focusBorder.onBlur}
                          placeholder="e.g. 1FT7W2BN0NED52782"
                          placeholderTextColor={mutedColor}
                          autoCapitalize="characters"
                          autoCorrect={false}
                          maxLength={17}
                          returnKeyType="done"
                          onSubmitEditing={handleSubmit}
                          editable={!submitting}
                        />
                      </Animated.View>
                      <TouchableOpacity
                        onPress={handleSubmit}
                        disabled={submitting || vinInput.length < 17}
                        activeOpacity={0.7}
                        style={{
                          height: 40,
                          paddingHorizontal: 14,
                          borderRadius: 8,
                          backgroundColor: brandColor,
                          alignItems: 'center',
                          justifyContent: 'center',
                          opacity: submitting || vinInput.length < 17 ? 0.5 : 1,
                        }}
                      >
                        {submitting ? (
                          <ActivityIndicator size="small" color="white" />
                        ) : (
                          <Text fontSize={14} fontWeight="600" color="$white">
                            Decode
                          </Text>
                        )}
                      </TouchableOpacity>
                    </XStack>
                    {error ? (
                      <Text fontSize={12} color="$danger" paddingTop="$1">
                        {error}
                      </Text>
                    ) : null}
                  </Animated.View>
                </YStack>
              )}
              {/* Collapsed: text label with staggered exit */}
              {!expanded && (
                <YStack gap="$1">
                  <Animated.View
                    style={{ opacity: exitTitleOpacity, transform: [{ translateY: exitTitleY }] }}
                  >
                    <Text fontSize={15} fontWeight="600" color="$color">
                      Have a VIN?
                    </Text>
                  </Animated.View>
                  <Animated.View
                    style={{ opacity: exitSubOpacity, transform: [{ translateY: exitSubY }] }}
                  >
                    <Text fontSize={13} color="$placeholderColor">
                      Paste it to decode specs and get started
                    </Text>
                  </Animated.View>
                </YStack>
              )}
            </YStack>
          </XStack>
        </AppCard>
      </TouchableOpacity>
    </Animated.View>
  )
}

export function ContextPicker({ onSelect, onVinSubmit }: ContextPickerProps) {
  const opacity = useFadeIn(400)

  return (
    <Animated.View style={{ flex: 1, opacity }}>
      <YStack
        flex={1}
        justifyContent="center"
        padding="$4"
        gap="$4"
        maxWidth={480}
        alignSelf="center"
        width="100%"
      >
        <YStack gap="$2" alignItems="center">
          <Text fontSize={20} fontWeight="700" color="$color" textAlign="center">
            How can I help?
          </Text>
          <Text fontSize={14} color="$placeholderColor" textAlign="center">
            Select where you are in the process, or just start typing below.
          </Text>
        </YStack>

        <YStack gap="$3">
          {CONTEXT_OPTIONS.map(({ context, label, subtitle, Icon }, index) => (
            <ContextOption
              key={context}
              context={context}
              label={label}
              subtitle={subtitle}
              Icon={Icon}
              index={index}
              onSelect={onSelect}
            />
          ))}
          <VinEntry onSubmit={onVinSubmit} index={CONTEXT_OPTIONS.length} />
        </YStack>
      </YStack>
    </Animated.View>
  )
}
