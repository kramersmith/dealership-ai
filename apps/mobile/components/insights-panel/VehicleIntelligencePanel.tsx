import { YStack, XStack, Text } from 'tamagui'

import { AppButton, AppCard } from '@/components/shared'
import { formatCurrency, getActiveDeal, getVehicleForDeal } from '@/lib/utils'
import { useChatStore } from '@/stores/chatStore'
import { useDealStore } from '@/stores/dealStore'

function SpecRow({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <XStack justifyContent="space-between" gap="$3">
      <Text color="$placeholderColor" fontSize={12}>
        {label}
      </Text>
      <Text color="$color" fontSize={12} textAlign="right" flex={1}>
        {value}
      </Text>
    </XStack>
  )
}

export function VehicleIntelligencePanel() {
  const dealState = useDealStore((s) => s.dealState)
  const decodeVinAssistForVehicle = useChatStore((s) => s.decodeVinAssistForVehicle)
  const checkVehicleHistory = useDealStore((s) => s.checkVehicleHistory)
  const getVehicleValuation = useDealStore((s) => s.getVehicleValuation)

  if (!dealState) return null

  const activeDeal = getActiveDeal(dealState)
  const vehicle = activeDeal ? getVehicleForDeal(dealState.vehicles, activeDeal) : null
  if (!vehicle) return null

  const intelligence = vehicle.intelligence
  const loadingAction = intelligence?.loadingAction ?? null

  return (
    <YStack gap="$3">
      <AppCard accent>
        <YStack gap="$3">
          <YStack gap="$1">
            <Text fontSize={12} fontWeight="600" color="$placeholderColor" letterSpacing={0.5}>
              Vehicle Intelligence
            </Text>
            <Text fontSize={15} fontWeight="700" color="$color">
              {[vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ')}
            </Text>
            <Text fontSize={13} color="$placeholderColor">
              Identify the car, check hidden title risk, and benchmark the asking price.
            </Text>
          </YStack>

          <XStack gap="$2" flexWrap="wrap">
            <AppButton
              size="$4"
              variant="secondary"
              onPress={() => {
                if (vehicle.vin) {
                  void decodeVinAssistForVehicle(vehicle.vin, vehicle.id)
                }
              }}
              disabled={loadingAction !== null}
            >
              {loadingAction === 'decode' ? 'Decoding...' : 'Decode VIN'}
            </AppButton>
            <AppButton
              size="$4"
              variant="secondary"
              onPress={() => checkVehicleHistory(vehicle.id, vehicle.vin)}
              disabled={loadingAction !== null}
            >
              {loadingAction === 'history' ? 'Checking...' : 'Check title history'}
            </AppButton>
            <AppButton
              size="$4"
              variant="secondary"
              onPress={() => getVehicleValuation(vehicle.id, vehicle.vin)}
              disabled={loadingAction !== null}
            >
              {loadingAction === 'valuation' ? 'Pricing...' : 'Get market value'}
            </AppButton>
          </XStack>

          {intelligence?.error ? (
            <Text color="$danger" fontSize={12}>
              {intelligence.error}
            </Text>
          ) : null}
        </YStack>
      </AppCard>

      {intelligence?.decode ? (
        <AppCard compact>
          <YStack gap="$2">
            <Text fontSize={13} fontWeight="700" color="$color">
              Decoded Vehicle Specs
            </Text>
            <SpecRow label="VIN" value={intelligence.decode.vin} />
            <SpecRow
              label="Vehicle"
              value={[
                intelligence.decode.year,
                intelligence.decode.make,
                intelligence.decode.model,
                intelligence.decode.trim,
              ]
                .filter(Boolean)
                .join(' ')}
            />
            <SpecRow label="Engine" value={intelligence.decode.engine} />
            <SpecRow label="Body type" value={intelligence.decode.bodyType} />
            <SpecRow label="Drivetrain" value={intelligence.decode.drivetrain} />
            <SpecRow label="Transmission" value={intelligence.decode.transmission} />
            <SpecRow label="Fuel" value={intelligence.decode.fuelType} />
            <Text fontSize={12} color="$placeholderColor">
              {intelligence.decode.sourceSummary ?? 'NHTSA vPIC decoded vehicle specs'}
            </Text>
          </YStack>
        </AppCard>
      ) : null}

      {intelligence?.historyReport ? (
        <AppCard compact>
          <YStack gap="$2">
            <Text fontSize={13} fontWeight="700" color="$color">
              Official Title and Brand Check
            </Text>
            <SpecRow
              label="Title brands"
              value={
                intelligence.historyReport.titleBrands.length > 0
                  ? intelligence.historyReport.titleBrands.join(', ')
                  : 'None reported'
              }
            />
            <SpecRow
              label="Risk flags"
              value={
                [
                  intelligence.historyReport.hasSalvage ? 'Salvage' : null,
                  intelligence.historyReport.hasTotalLoss ? 'Total loss' : null,
                  intelligence.historyReport.hasTheftRecord ? 'Theft record' : null,
                  intelligence.historyReport.hasOdometerIssue ? 'Odometer issue' : null,
                ]
                  .filter(Boolean)
                  .join(' | ') || 'No major title flags reported'
              }
            />
            <Text fontSize={12} color="$placeholderColor">
              {intelligence.historyReport.coverageNotes ??
                'NMVTIS-style title and brand coverage; not full service history.'}
            </Text>
          </YStack>
        </AppCard>
      ) : null}

      {intelligence?.valuation ? (
        <AppCard compact>
          <YStack gap="$2">
            <Text fontSize={13} fontWeight="700" color="$color">
              {intelligence.valuation.valuationLabel}
            </Text>
            <Text fontSize={20} fontWeight="800" color="$color">
              {formatCurrency(intelligence.valuation.amount ?? null)}
            </Text>
            <Text fontSize={12} color="$placeholderColor">
              {intelligence.valuation.sourceSummary ??
                'Listing-based estimate for negotiation context, not transaction value.'}
            </Text>
          </YStack>
        </AppCard>
      ) : null}
    </YStack>
  )
}
