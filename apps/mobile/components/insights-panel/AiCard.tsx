import { useState, useCallback, useRef } from 'react'
import { TouchableOpacity, Animated } from 'react-native'
import { YStack } from 'tamagui'
import { MessageCircle } from '@tamagui/lucide-icons'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import type { AiPanelCard, QuotedCard } from '@/lib/types'
import { BriefingCard } from './BriefingCard'
import { NumbersCard } from './NumbersCard'
import { AiVehicleCard } from './AiVehicleCard'
import { WarningCard } from './WarningCard'
import { AiComparisonCard } from './AiComparisonCard'
import { TipCard } from './TipCard'
import { NotesCard } from './NotesCard'
import { AiChecklistCard } from './AiChecklistCard'
import { SuccessCard } from './SuccessCard'
import { CardReplyInput } from './CardReplyInput'

/** Duration in ms for the reply drawer close animation. */
const REPLY_CLOSE_DURATION_MS = 200
/** Duration in ms for the reply drawer open animation. */
const REPLY_OPEN_DURATION_MS = 250

interface AiCardProps {
  card: AiPanelCard
  onSendReply?: (text: string, quotedCard: QuotedCard) => Promise<void>
}

function renderCardContent(card: AiPanelCard): React.ReactNode {
  switch (card.template) {
    case 'briefing':
      return <BriefingCard title={card.title} content={card.content} priority={card.priority} />
    case 'numbers':
      return <NumbersCard title={card.title} content={card.content} />
    case 'vehicle':
      return <AiVehicleCard title={card.title} content={card.content} />
    case 'warning':
      return <WarningCard title={card.title} content={card.content} priority={card.priority} />
    case 'comparison':
      return <AiComparisonCard title={card.title} content={card.content} />
    case 'tip':
      return <TipCard title={card.title} content={card.content} />
    case 'notes':
      return <NotesCard title={card.title} content={card.content} />
    case 'checklist':
      return <AiChecklistCard title={card.title} content={card.content} />
    case 'success':
      return <SuccessCard title={card.title} content={card.content} />
    default:
      return null
  }
}

export function AiCard({ card, onSendReply }: AiCardProps) {
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyVisible, setReplyVisible] = useState(false)
  const slideAnim = useRef(new Animated.Value(0)).current

  const toggleReply = useCallback(() => {
    if (replyOpen) {
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
        {renderCardContent(card)}
        {onSendReply && (
          <TouchableOpacity
            onPress={toggleReply}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel={replyOpen ? 'Close card reply' : 'Reply to insight card'}
            accessibilityState={{ expanded: replyOpen }}
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
