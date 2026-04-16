import { useState, useCallback, useRef } from 'react'
import { Animated, Platform, Pressable } from 'react-native'
import { YStack, useTheme } from 'tamagui'
import { AppCard } from '@/components/shared'
import { HoverLiftFrame } from '@/components/shared/HoverLiftFrame'
import { palette } from '@/lib/theme/tokens'
import { USE_NATIVE_DRIVER } from '@/lib/platform'
import type { AiPanelCard, NegotiationContext, NegotiationStance, QuotedCard } from '@/lib/types'
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
import { SituationBar } from './SituationBar'

const NEGOTIATION_STANCES: readonly NegotiationStance[] = [
  'researching',
  'preparing',
  'engaging',
  'negotiating',
  'holding',
  'walking',
  'waiting',
  'financing',
  'closing',
  'post_purchase',
] as const

function isNegotiationStance(value: string): value is NegotiationStance {
  return (NEGOTIATION_STANCES as readonly string[]).includes(value)
}

/** Duration in ms for the reply drawer close animation. */
const REPLY_CLOSE_DURATION_MS = 200
/** Duration in ms for the reply drawer open animation. */
const REPLY_OPEN_DURATION_MS = 250

interface AiCardProps {
  card: AiPanelCard
  onSendReply?: (text: string, quotedCard: QuotedCard) => Promise<void>
}

function renderCardContent(card: AiPanelCard): React.ReactNode {
  if (card.kind === 'phase') {
    const rawStance = card.content?.stance
    const situation =
      typeof card.content?.situation === 'string' ? card.content.situation.trim() : ''
    const stance: NegotiationStance =
      typeof rawStance === 'string' && isNegotiationStance(rawStance) ? rawStance : 'researching'
    if (!situation) {
      return null
    }
    const context: NegotiationContext = { stance, situation }
    return (
      <AppCard compact interactive={false}>
        <SituationBar
          context={context}
          layout="insightCard"
          cardTitle={card.title?.trim() || 'Status'}
        />
      </AppCard>
    )
  }
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
  const theme = useTheme()
  const shadowColor = theme.shadowColor?.val ?? palette.shadowOverlay
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

  const cardBody = (
    <YStack
      width="100%"
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
    </YStack>
  )

  const tappableBody =
    onSendReply != null ? (
      <Pressable
        onPress={toggleReply}
        {...(Platform.OS === 'web'
          ? {}
          : {
              accessibilityRole: 'button' as const,
            })}
        accessibilityLabel={replyOpen ? 'Close card reply' : 'Reply to insight card'}
        accessibilityState={{ expanded: replyOpen }}
        accessible
        style={({ pressed }) => ({
          alignSelf: 'stretch',
          width: '100%',
          padding: 0,
          margin: 0,
          opacity: pressed ? 0.97 : 1,
          ...(Platform.OS === 'web'
            ? ({
                cursor: 'pointer',
                alignItems: 'stretch',
                textAlign: 'left',
              } as const)
            : null),
        })}
      >
        {cardBody}
      </Pressable>
    ) : (
      cardBody
    )

  const liftedBody =
    onSendReply != null && Platform.OS === 'web' ? (
      <HoverLiftFrame
        shadowColor={shadowColor}
        borderRadius={12}
        interactive
        layoutStyle={{ width: '100%' }}
      >
        {tappableBody}
      </HoverLiftFrame>
    ) : (
      tappableBody
    )

  return (
    <YStack>
      <YStack position="relative" zIndex={2}>
        {liftedBody}
      </YStack>
      {replyOpen && onSendReply && (
        <Animated.View
          style={{
            zIndex: 0,
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
