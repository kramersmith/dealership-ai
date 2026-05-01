import { useState, useRef, useEffect } from 'react'
import { Modal, TouchableOpacity, Animated, Platform, View } from 'react-native'
import { YStack, XStack, Text, Spinner } from 'tamagui'
import { modalWebFontFamilyStyle } from '@/lib/modalWebTypography'
import { DISPLAY_FONT_FAMILY, MONO_FONT_FAMILY } from '@/lib/constants'
import { palette } from '@/lib/theme/tokens'
import { ModalGhostButton, ModalPrimaryButton } from '@/components/shared'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { focusDomElementByIdsAfterModalShow } from '@/lib/webModalFocus'
import { useChatStore } from '@/stores/chatStore'
import { useDealStore } from '@/stores/dealStore'
import { api } from '@/lib/api'
import type { VinAssistDecodedVehicle } from '@/lib/types'

type InterceptPhase = 'prompt' | 'decoding' | 'decoded' | 'failed'

const VIN_INTERCEPT_PRIMARY_DOM_ID = 'vin-intercept-initial-focus'
const VIN_INTERCEPT_FOCUS_ROOT_DOM_ID = 'vin-intercept-focus-root'

interface VinInterceptModalProps {
  visible: boolean
  vin: string
  onComplete: (decoded: boolean) => void
  onSkip: () => void
}

export function VinInterceptModal({ visible, vin, onComplete, onSkip }: VinInterceptModalProps) {
  const [phase, setPhase] = useState<InterceptPhase>('prompt')
  const [decoded, setDecoded] = useState<VinAssistDecodedVehicle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scale = useRef(new Animated.Value(0.9)).current
  const contentOpacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (visible) {
      scale.setValue(0.9)
      contentOpacity.setValue(0)
      Animated.parallel([
        Animated.timing(scale, {
          toValue: 1,
          duration: 200,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
      ]).start()
    }
  }, [visible, scale, contentOpacity])

  const handleDecode = async () => {
    const sessionId = useChatStore.getState().activeSessionId
    if (!sessionId) return

    setPhase('decoding')
    setError(null)

    try {
      const vehicle = await api.upsertVehicleFromVin(sessionId, vin)
      useDealStore.getState().setVehicleIntelligenceLoading(vehicle.id, 'decode')
      const intelligence = await api.decodeVehicleVin(sessionId, vehicle.id, vin)

      if (!intelligence.decode) {
        throw new Error('VIN decode returned no vehicle details')
      }

      const decodedVehicle: VinAssistDecodedVehicle = {
        year: intelligence.decode.year,
        make: intelligence.decode.make,
        model: intelligence.decode.model,
        trim: intelligence.decode.trim,
        partial:
          !intelligence.decode.year || !intelligence.decode.make || !intelligence.decode.model,
      }
      setDecoded(decodedVehicle)
      setPhase('decoded')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'VIN decode failed')
      setPhase('failed')
    }
  }

  const handleConfirm = async () => {
    const sessionId = useChatStore.getState().activeSessionId
    if (!sessionId) return

    // Find the vehicle by VIN in deal state
    const vehicles = useDealStore.getState().dealState?.vehicles ?? []
    const vehicle = vehicles.find((candidate) => candidate.vin === vin)
    if (vehicle) {
      await api.confirmVehicleIdentity(sessionId, vehicle.id, 'confirmed')
      await Promise.all([
        useDealStore.getState().loadDealState(sessionId),
        useChatStore.getState().loadSessions(),
      ])
    }

    resetAndClose(true)
  }

  const handleSkip = () => {
    resetAndClose(false)
  }

  const resetAndClose = (wasDecoded: boolean) => {
    setPhase('prompt')
    setDecoded(null)
    setError(null)
    if (wasDecoded) {
      onComplete(true)
    } else {
      onSkip()
    }
  }

  const vehicleLabel = decoded
    ? [decoded.year, decoded.make, decoded.model, decoded.trim].filter(Boolean).join(' ')
    : null

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleSkip}
      onShow={() =>
        focusDomElementByIdsAfterModalShow(
          VIN_INTERCEPT_PRIMARY_DOM_ID,
          VIN_INTERCEPT_FOCUS_ROOT_DOM_ID
        )
      }
    >
      {Platform.OS === 'web' ? (
        <View
          {...({ id: VIN_INTERCEPT_FOCUS_ROOT_DOM_ID, tabIndex: -1 } as any)}
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            opacity: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        />
      ) : null}
      <TouchableOpacity
        style={{
          flex: 1,
          backgroundColor: 'rgba(2, 6, 23, 0.72)',
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 16,
          ...modalWebFontFamilyStyle(),
          ...(Platform.OS === 'web'
            ? ({
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
              } as any)
            : null),
        }}
        activeOpacity={1}
        onPress={() => {
          if (phase === 'prompt' || phase === 'failed') handleSkip()
        }}
      >
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ width: '100%' }}>
          <Animated.View style={{ transform: [{ scale }], opacity: contentOpacity, width: '100%' }}>
            <YStack
              backgroundColor="rgba(15, 23, 42, 0.92)"
              borderRadius={20}
              padding={24}
              width="100%"
              maxWidth={400}
              alignSelf="center"
              gap={20}
              borderWidth={1}
              borderColor={palette.ghostBorder}
              {...(Platform.OS === 'web'
                ? ({
                    style: {
                      backdropFilter: 'blur(20px) saturate(1.15)',
                      WebkitBackdropFilter: 'blur(20px) saturate(1.15)',
                    },
                  } as any)
                : {})}
            >
              {/* Header */}
              <YStack gap={8}>
                <Text
                  fontSize={20}
                  fontWeight="600"
                  color={palette.slate50}
                  letterSpacing={-0.3}
                  fontFamily={DISPLAY_FONT_FAMILY}
                >
                  {phase === 'decoded' ? 'Vehicle Identified' : 'VIN Detected'}
                </Text>
                <Text fontSize={14} color={palette.slate400} lineHeight={20}>
                  {phase === 'prompt' &&
                    'We found a VIN in your message. Decode it now so the AI can give you vehicle-specific advice from the start.'}
                  {phase === 'decoding' && 'Looking up vehicle details...'}
                  {phase === 'decoded' && 'Is this the right vehicle?'}
                  {phase === 'failed' &&
                    (error ?? 'Decode failed. You can retry or continue without decoding.')}
                </Text>
              </YStack>

              {/* VIN display */}
              <YStack
                gap={4}
                paddingHorizontal={12}
                paddingVertical={10}
                borderRadius={10}
                backgroundColor="rgba(2, 6, 23, 0.65)"
                borderWidth={1}
                borderColor={palette.ghostBgHover}
              >
                <Text
                  fontSize={11}
                  color={palette.slate500}
                  letterSpacing={0.6}
                  textTransform="uppercase"
                >
                  VIN
                </Text>
                <Text
                  fontSize={14}
                  fontWeight="600"
                  color={palette.slate50}
                  fontFamily={MONO_FONT_FAMILY}
                  letterSpacing={0.4}
                >
                  {vin}
                </Text>
              </YStack>

              {/* Decoded vehicle display */}
              {decoded && phase === 'decoded' ? (
                <YStack
                  gap={4}
                  paddingHorizontal={12}
                  paddingVertical={10}
                  borderRadius={10}
                  backgroundColor={palette.copilotEmeraldMuted}
                  borderWidth={1}
                  borderColor={palette.copilotEmeraldBorder25}
                >
                  <Text
                    fontSize={11}
                    color={palette.copilotEmerald}
                    letterSpacing={0.6}
                    textTransform="uppercase"
                  >
                    Decoded Vehicle
                  </Text>
                  <Text fontSize={16} fontWeight="700" color={palette.slate50}>
                    {vehicleLabel}
                  </Text>
                  {decoded.partial ? (
                    <Text fontSize={12} color={palette.slate400}>
                      Some details may be incomplete.
                    </Text>
                  ) : null}
                </YStack>
              ) : null}

              {/* Loading spinner */}
              {phase === 'decoding' ? (
                <XStack alignItems="center" gap="$2" justifyContent="center" paddingVertical="$3">
                  <Spinner size="small" color={palette.copilotEmerald} />
                  <Text fontSize={13} color={palette.slate400}>
                    Decoding VIN...
                  </Text>
                </XStack>
              ) : null}

              {/* Action buttons */}
              {phase === 'prompt' ? (
                <XStack gap={12} justifyContent="flex-end">
                  <ModalGhostButton onPress={handleSkip}>Skip</ModalGhostButton>
                  <ModalPrimaryButton
                    onPress={handleDecode}
                    webDomId={VIN_INTERCEPT_PRIMARY_DOM_ID}
                  >
                    Decode VIN
                  </ModalPrimaryButton>
                </XStack>
              ) : null}

              {phase === 'decoded' ? (
                <XStack gap={12} justifyContent="flex-end">
                  <ModalGhostButton onPress={handleSkip}>No</ModalGhostButton>
                  <ModalPrimaryButton
                    onPress={handleConfirm}
                    webDomId={VIN_INTERCEPT_PRIMARY_DOM_ID}
                  >
                    Yes, use this
                  </ModalPrimaryButton>
                </XStack>
              ) : null}

              {phase === 'failed' ? (
                <XStack gap={12} justifyContent="flex-end">
                  <ModalGhostButton onPress={handleSkip}>Skip</ModalGhostButton>
                  <ModalPrimaryButton
                    onPress={handleDecode}
                    webDomId={VIN_INTERCEPT_PRIMARY_DOM_ID}
                  >
                    Retry
                  </ModalPrimaryButton>
                </XStack>
              ) : null}
            </YStack>
          </Animated.View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}
