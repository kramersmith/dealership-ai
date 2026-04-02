import { APP_NAME } from '@/lib/constants'
import type { DealState } from '@/lib/types'
import { getPrimaryVehicles } from '@/lib/utils'

export interface HeaderTitleInfo {
  title: string
  source: 'session_title' | 'decoded_vehicle' | 'vehicle' | 'fallback_title'
  cleanedRawTitle: string | null
  decodedTitle: string | null
  vehicleTitle: string | null
}

export function normalizeHeaderTitle(title: string) {
  return title
    .split(' - ')[0]
    .trim()
    .replace(/\b[A-Z]{2,}\b/g, (word) => word.charAt(0) + word.slice(1).toLowerCase())
}

export function getVehicleAwareHeaderTitleInfo(
  rawTitle: string | null | undefined,
  dealState: DealState | null,
  fallbackTitle = APP_NAME
): HeaderTitleInfo {
  const cleanedRawTitle = rawTitle ? normalizeHeaderTitle(rawTitle) : null
  const primaryVehicle = dealState ? getPrimaryVehicles(dealState.vehicles)[0] : null
  const decoded = primaryVehicle?.intelligence?.decode
  const decodedTitle = [decoded?.year, decoded?.make, decoded?.model, decoded?.trim]
    .filter(Boolean)
    .join(' ')
  const normalizedDecodedTitle = decodedTitle ? normalizeHeaderTitle(decodedTitle) : null
  const vehicleTitle = primaryVehicle
    ? normalizeHeaderTitle(
        [primaryVehicle.year, primaryVehicle.make, primaryVehicle.model, primaryVehicle.trim]
          .filter(Boolean)
          .join(' ')
      )
    : null

  if (cleanedRawTitle) {
    return {
      title: cleanedRawTitle,
      source: 'session_title',
      cleanedRawTitle,
      decodedTitle: normalizedDecodedTitle,
      vehicleTitle,
    }
  }

  if (normalizedDecodedTitle) {
    return {
      title: normalizedDecodedTitle,
      source: 'decoded_vehicle',
      cleanedRawTitle,
      decodedTitle: normalizedDecodedTitle,
      vehicleTitle,
    }
  }

  if (vehicleTitle) {
    return {
      title: vehicleTitle,
      source: 'vehicle',
      cleanedRawTitle,
      decodedTitle: normalizedDecodedTitle,
      vehicleTitle,
    }
  }

  return {
    title: fallbackTitle,
    source: 'fallback_title',
    cleanedRawTitle,
    decodedTitle: normalizedDecodedTitle,
    vehicleTitle,
  }
}
