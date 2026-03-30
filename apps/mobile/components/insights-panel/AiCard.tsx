import type { AiPanelCard, DealState } from '@/lib/types'
import { getActiveDeal, getVehicleForDeal } from '@/lib/utils'
import { BriefingCard } from './BriefingCard'
import { NumbersCard } from './NumbersCard'
import { AiVehicleCard } from './AiVehicleCard'
import { WarningCard } from './WarningCard'
import { AiComparisonCard } from './AiComparisonCard'
import { TipCard } from './TipCard'
import { AiChecklistCard } from './AiChecklistCard'
import { SuccessCard } from './SuccessCard'

interface AiCardProps {
  card: AiPanelCard
  dealState: DealState
  onCorrectNumber?: (dealId: string, field: string, value: number | null) => void
  onCorrectVehicleField?: (
    vehicleId: string,
    field: string,
    value: string | number | undefined
  ) => void
  onToggleChecklist?: (index: number) => void
}

export function AiCard({
  card,
  dealState,
  onCorrectNumber,
  onCorrectVehicleField,
  onToggleChecklist,
}: AiCardProps) {
  switch (card.type) {
    case 'briefing':
      return <BriefingCard title={card.title} content={card.content} priority={card.priority} />

    case 'numbers':
      return (
        <NumbersCard
          title={card.title}
          content={card.content}
          dealId={dealState.activeDealId}
          onCorrectNumber={onCorrectNumber}
        />
      )

    case 'vehicle': {
      // Look up the real vehicle ID from the deal state for corrections
      const activeDeal = getActiveDeal(dealState)
      const activeVehicle = activeDeal ? getVehicleForDeal(dealState.vehicles, activeDeal) : null
      return (
        <AiVehicleCard
          title={card.title}
          content={card.content}
          vehicleId={activeVehicle?.id}
          onCorrectVehicleField={onCorrectVehicleField}
        />
      )
    }

    case 'warning':
      return <WarningCard title={card.title} content={card.content} priority={card.priority} />

    case 'comparison':
      return <AiComparisonCard title={card.title} content={card.content} />

    case 'tip':
      return <TipCard title={card.title} content={card.content} />

    case 'checklist':
      return (
        <AiChecklistCard title={card.title} content={card.content} onToggle={onToggleChecklist} />
      )

    case 'success':
      return <SuccessCard title={card.title} content={card.content} />

    default:
      return null
  }
}
