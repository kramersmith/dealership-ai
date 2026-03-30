import type { AiCardPriority, AiCardType } from '@/lib/types'
import { BriefingCard } from './BriefingCard'
import { NumbersCard } from './NumbersCard'
import { AiVehicleCard } from './AiVehicleCard'
import { WarningCard } from './WarningCard'
import { AiComparisonCard } from './AiComparisonCard'
import { TipCard } from './TipCard'
import { AiChecklistCard } from './AiChecklistCard'
import { SuccessCard } from './SuccessCard'

interface RenderCardOptions {
  type: AiCardType
  title: string
  content: Record<string, any>
  priority?: AiCardPriority
  /** Vehicle-specific: real vehicle ID for inline corrections. */
  vehicleId?: string
  onCorrectVehicleField?: (
    vehicleId: string,
    field: string,
    value: string | number | undefined
  ) => void
  onToggleChecklist?: (index: number) => void
}

/**
 * Shared card renderer used by both AiCard (insights panel) and
 * QuotedCardPreview (chat bubble). Keeps card-type-to-component mapping
 * in a single place.
 */
export function renderCardByType(options: RenderCardOptions): React.ReactNode {
  const {
    type,
    title,
    content,
    priority = 'normal',
    vehicleId,
    onCorrectVehicleField,
    onToggleChecklist,
  } = options

  switch (type) {
    case 'briefing':
      return <BriefingCard title={title} content={content} priority={priority} />

    case 'numbers':
      return <NumbersCard title={title} content={content} />

    case 'vehicle':
      return (
        <AiVehicleCard
          title={title}
          content={content}
          vehicleId={vehicleId}
          onCorrectVehicleField={onCorrectVehicleField}
        />
      )

    case 'warning':
      return <WarningCard title={title} content={content} priority={priority} />

    case 'comparison':
      return <AiComparisonCard title={title} content={content} />

    case 'tip':
      return <TipCard title={title} content={content} />

    case 'checklist':
      return <AiChecklistCard title={title} content={content} onToggle={onToggleChecklist} />

    case 'success':
      return <SuccessCard title={title} content={content} />

    default:
      return null
  }
}
