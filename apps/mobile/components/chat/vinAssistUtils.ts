import type { VinAssistItem } from '@/lib/types'

/** Human-readable label for a VIN assist item; falls back to raw VIN when undecoded. */
export function vinAssistVehicleLabel(item: VinAssistItem): string {
  const decoded = item.decodedVehicle
  if (!decoded) return item.vin
  return [decoded.year, decoded.make, decoded.model, decoded.trim].filter(Boolean).join(' ')
}
