import { useState, useCallback, useRef } from 'react'
import { TouchableOpacity, Animated } from 'react-native'
import { YStack } from 'tamagui'
import { MessageCircle } from '@tamagui/lucide-icons'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import type { AiPanelCard, DealState, QuotedCard } from '@/lib/types'
import { getActiveDeal, getVehicleForDeal } from '@/lib/utils'
import { renderCardByType } from './renderCardByType'
import { CardReplyInput } from './CardReplyInput'

/** Duration in ms for the reply drawer close animation. */
const REPLY_CLOSE_DURATION_MS = 200
/** Duration in ms for the reply drawer open animation. */
const REPLY_OPEN_DURATION_MS = 250

interface AiCardProps {
  card: AiPanelCard
  dealState: DealState
  onCorrectVehicleField?: (
    vehicleId: string,
    field: string,
    value: string | number | undefined
  ) => void
  onToggleChecklist?: (index: number) => void
  onSendReply?: (text: string, quotedCard: QuotedCard) => Promise<void>
}

export function AiCard({
  card,
  dealState,
  onCorrectVehicleField,
  onToggleChecklist,
  onSendReply,
}: AiCardProps) {
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyVisible, setReplyVisible] = useState(false)
  const slideAnim = useRef(new Animated.Value(0)).current

  // Resolve vehicle ID for inline corrections
  const activeDeal = card.type === 'vehicle' ? getActiveDeal(dealState) : null
  const activeVehicle = activeDeal ? getVehicleForDeal(dealState.vehicles, activeDeal) : null

  const toggleReply = useCallback(() => {
    if (replyOpen) {
      // Close: slide up then unmount
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: REPLY_CLOSE_DURATION_MS,
        useNativeDriver: USE_NATIVE_DRIVER,
      }).start(({ finished }) => {
        if (finished) {
          setReplyOpen(false)
          setReplyVisible(false)
        }
      })
    } else {
      // Open: mount then slide down
      setReplyOpen(true)
      setReplyVisible(true)
      slideAnim.setValue(0)
      Animated.timing(slideAnim, {
        toValue: 1,
        duration: REPLY_OPEN_DURATION_MS,
        useNativeDriver: USE_NATIVE_DRIVER,
      }).start()
    }
  }, [replyOpen, slideAnim])

  const handleClose = useCallback(() => {
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: REPLY_CLOSE_DURATION_MS,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start(({ finished }) => {
      if (finished) {
        setReplyOpen(false)
        setReplyVisible(false)
      }
    })
  }, [slideAnim])

  return (
    <YStack>
      <YStack
        position="relative"
        zIndex={1}
        {...(replyVisible
          ? {
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
            }
          : {})}
      >
        {renderCardByType({
          type: card.type,
          title: card.title,
          content: card.content,
          priority: card.priority,
          vehicleId: activeVehicle?.id,
          onCorrectVehicleField,
          onToggleChecklist,
        })}
        {onSendReply && (
          <TouchableOpacity
            onPress={toggleReply}
            activeOpacity={0.6}
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              width: 44,
              height: 44,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <MessageCircle size={14} color="$placeholderColor" opacity={0.6} />
          </TouchableOpacity>
        )}
      </YStack>
      {replyOpen && onSendReply && (
        <Animated.View
          style={{
            opacity: slideAnim,
            transform: [
              {
                translateY: slideAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-20, 0],
                }),
              },
            ],
          }}
        >
          <CardReplyInput card={card} onSend={onSendReply} onClose={handleClose} />
        </Animated.View>
      )}
    </YStack>
  )
}
