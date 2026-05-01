import { useRef, useEffect } from 'react'
import { Modal, TouchableOpacity, Animated, Platform, View } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { modalWebFontFamilyStyle } from '@/lib/modalWebTypography'
import { DISPLAY_FONT_FAMILY } from '@/lib/constants'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { focusDomElementByIdsAfterModalShow } from '@/lib/webModalFocus'
import { palette } from '@/lib/theme/tokens'
import { ModalGhostButton, ModalPrimaryButton } from './ModalButtons'

interface ConfirmModalProps {
  visible: boolean
  title: string
  message: string
  confirmLabel?: string
  /** Default `danger` (delete flows). Use `primary` for neutral confirmations (e.g. branch edit). */
  confirmVariant?: 'danger' | 'primary'
  onConfirm: () => void
  onCancel: () => void
  /** Web: DOM id for the cancel control so focus can move into the modal (avoid duplicate ids across screens). */
  webCancelDomId?: string
}

export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel = 'Delete',
  confirmVariant = 'danger',
  onConfirm,
  onCancel,
  webCancelDomId = 'confirm-modal-cancel',
}: ConfirmModalProps) {
  const scale = useRef(new Animated.Value(0.9)).current
  const contentOpacity = useRef(new Animated.Value(0)).current
  const focusRootId = `${webCancelDomId}-focus-root`

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

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      onShow={() => focusDomElementByIdsAfterModalShow(webCancelDomId, focusRootId)}
    >
      {Platform.OS === 'web' ? (
        <View
          // Programmatic focus target inside the portal if Tamagui hasn’t put `id` on the button yet.
          {...({ id: focusRootId, tabIndex: -1 } as any)}
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
        onPress={onCancel}
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
              <YStack gap={8}>
                <Text
                  fontSize={20}
                  fontWeight="600"
                  color={palette.slate50}
                  letterSpacing={-0.3}
                  fontFamily={DISPLAY_FONT_FAMILY}
                >
                  {title}
                </Text>
                <Text fontSize={14} color={palette.slate400} lineHeight={20}>
                  {message}
                </Text>
              </YStack>

              <XStack gap={12} justifyContent="flex-end">
                <ModalGhostButton onPress={onCancel} webDomId={webCancelDomId}>
                  Cancel
                </ModalGhostButton>
                <ModalPrimaryButton variant={confirmVariant} onPress={onConfirm}>
                  {confirmLabel}
                </ModalPrimaryButton>
              </XStack>
            </YStack>
          </Animated.View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}
