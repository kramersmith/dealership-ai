import { useRef, useEffect } from 'react'
import { Modal, TouchableOpacity, Animated, Platform, View } from 'react-native'
import { YStack, XStack, Text } from 'tamagui'
import { modalWebFontFamilyStyle } from '@/lib/modalWebTypography'
import { palette } from '@/lib/theme/tokens'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import { focusDomElementByIdsAfterModalShow } from '@/lib/webModalFocus'
import { AppButton } from './AppButton'

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
          backgroundColor: palette.overlay,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 16,
          ...modalWebFontFamilyStyle(),
        }}
        activeOpacity={1}
        onPress={onCancel}
      >
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ width: '100%' }}>
          <Animated.View style={{ transform: [{ scale }], opacity: contentOpacity, width: '100%' }}>
            <YStack
              backgroundColor="$backgroundStrong"
              borderRadius="$4"
              padding="$5"
              width="100%"
              maxWidth={320}
              alignSelf="center"
              gap="$4"
              borderWidth={1}
              borderColor="$borderColor"
            >
              <YStack gap="$2">
                <Text fontSize={18} fontWeight="700" color="$color">
                  {title}
                </Text>
                <Text fontSize={14} color="$placeholderColor" lineHeight={20}>
                  {message}
                </Text>
              </YStack>

              <XStack gap="$3" justifyContent="flex-end">
                <AppButton
                  variant="ghost"
                  compact
                  onPress={onCancel}
                  minWidth={80}
                  {...(Platform.OS === 'web' ? ({ id: webCancelDomId } as any) : {})}
                >
                  Cancel
                </AppButton>
                <AppButton
                  variant={confirmVariant === 'primary' ? 'primary' : 'danger'}
                  compact
                  onPress={onConfirm}
                  minWidth={80}
                >
                  {confirmLabel}
                </AppButton>
              </XStack>
            </YStack>
          </Animated.View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}
