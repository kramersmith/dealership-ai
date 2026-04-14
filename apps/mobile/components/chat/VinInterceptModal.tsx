import { useState, useRef, useEffect } from 'react'
import { Modal, TouchableOpacity, Animated, Platform, View } from 'react-native'
import { YStack, XStack, Text, Spinner } from 'tamagui'
import { modalWebFontFamilyStyle } from '@/lib/modalWebTypography'
import { palette } from '@/lib/theme/tokens'
import { AppButton } from '@/components/shared'
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
          backgroundColor: palette.overlay,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 16,
          ...modalWebFontFamilyStyle(),
        }}
        activeOpacity={1}
        onPress={() => {
          if (phase === 'prompt' || phase === 'failed') handleSkip()
        }}
      >
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ width: '100%' }}>
          <Animated.View style={{ transform: [{ scale }], opacity: contentOpacity, width: '100%' }}>
            <YStack
              backgroundColor="$backgroundStrong"
              borderRadius="$4"
              padding="$5"
              width="100%"
              maxWidth={340}
              alignSelf="center"
              gap="$4"
              borderWidth={1}
              borderColor="$borderColor"
            >
              {/* Header */}
              <YStack gap="$2">
                <Text fontSize={18} fontWeight="700" color="$color">
                  {phase === 'decoded' ? 'Vehicle Identified' : 'VIN Detected'}
                </Text>
                <Text fontSize={14} color="$placeholderColor" lineHeight={20}>
                  {phase === 'prompt' &&
                    'We found a VIN in your message. Decode it now so the AI can give you vehicle-specific advice from the start.'}
                  {phase === 'decoding' && 'Looking up vehicle details...'}
                  {phase === 'decoded' && 'Is this the right vehicle?'}
                  {phase === 'failed' &&
                    (error ?? 'Decode failed. You can retry or continue without decoding.')}
                </Text>
              </YStack>

              {/* VIN display */}
              <YStack gap="$1">
                <Text fontSize={12} color="$placeholderColor">
                  VIN
                </Text>
                <Text fontSize={14} fontWeight="600" color="$color">
                  {vin}
                </Text>
              </YStack>

              {/* Decoded vehicle display */}
              {decoded && phase === 'decoded' ? (
                <YStack gap="$1" backgroundColor="$backgroundHover" padding="$3" borderRadius="$3">
                  <Text fontSize={12} color="$placeholderColor">
                    Decoded Vehicle
                  </Text>
                  <Text fontSize={16} fontWeight="700" color="$color">
                    {vehicleLabel}
                  </Text>
                  {decoded.partial ? (
                    <Text fontSize={12} color="$placeholderColor">
                      Some details may be incomplete.
                    </Text>
                  ) : null}
                </YStack>
              ) : null}

              {/* Loading spinner */}
              {phase === 'decoding' ? (
                <XStack alignItems="center" gap="$2" justifyContent="center" paddingVertical="$3">
                  <Spinner size="small" color="$brand" />
                  <Text fontSize={13} color="$placeholderColor">
                    Decoding VIN...
                  </Text>
                </XStack>
              ) : null}

              {/* Action buttons */}
              {phase === 'prompt' ? (
                <YStack gap="$2">
                  <AppButton
                    compact
                    onPress={handleDecode}
                    {...(Platform.OS === 'web'
                      ? ({ id: VIN_INTERCEPT_PRIMARY_DOM_ID } as any)
                      : {})}
                  >
                    Decode VIN
                  </AppButton>
                  <AppButton compact variant="outline" onPress={handleSkip}>
                    Continue without decoding
                  </AppButton>
                </YStack>
              ) : null}

              {phase === 'decoded' ? (
                <YStack gap="$2">
                  <AppButton
                    compact
                    onPress={handleConfirm}
                    {...(Platform.OS === 'web'
                      ? ({ id: VIN_INTERCEPT_PRIMARY_DOM_ID } as any)
                      : {})}
                  >
                    Yes, use this vehicle
                  </AppButton>
                  <AppButton compact variant="outline" onPress={handleSkip}>
                    No, continue without decoding
                  </AppButton>
                </YStack>
              ) : null}

              {phase === 'failed' ? (
                <YStack gap="$2">
                  <AppButton
                    compact
                    onPress={handleDecode}
                    {...(Platform.OS === 'web'
                      ? ({ id: VIN_INTERCEPT_PRIMARY_DOM_ID } as any)
                      : {})}
                  >
                    Retry Decode
                  </AppButton>
                  <AppButton compact variant="outline" onPress={handleSkip}>
                    Continue without decoding
                  </AppButton>
                </YStack>
              ) : null}
            </YStack>
          </Animated.View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}
