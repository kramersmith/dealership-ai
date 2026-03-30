/** Convert snake_case keys to camelCase. Handles nested objects shallowly. */
export function snakeToCamel(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
    result[camelKey] = value
  }
  return result
}

export function formatCurrency(value: number | null): string {
  if (value === null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatPercent(value: number | null): string {
  if (value === null) return '—'
  return `${value.toFixed(2)}%`
}

export function formatMonths(value: number | null): string {
  if (value === null) return '—'
  return `${value} mo`
}

export function formatMileage(value: number | undefined | null): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('en-US').format(value) + ' mi'
}

export function formatElapsedTime(startedAt: string | null): string {
  if (!startedAt) return '0:00'
  const start = new Date(startedAt).getTime()
  const now = Date.now()
  const seconds = Math.floor((now - start) / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

export function vehicleSummary(
  vehicle: { year: number; make: string; model: string; trim?: string } | null
): string {
  if (!vehicle) return 'No vehicle set'
  const parts = [vehicle.year, vehicle.make, vehicle.model]
  if (vehicle.trim) parts.push(vehicle.trim)
  return parts.join(' ')
}

/** Strip markdown syntax for plain-text display (previews, summaries). */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1') // bold
    .replace(/__(.+?)__/g, '$1') // bold alt
    .replace(/\*(.+?)\*/g, '$1') // italic
    .replace(/_(.+?)_/g, '$1') // italic alt
    .replace(/~~(.+?)~~/g, '$1') // strikethrough
    .replace(/`(.+?)`/g, '$1') // inline code
    .replace(/^#{1,6}\s+/gm, '') // headings
    .replace(/^>\s?/gm, '') // blockquotes
    .replace(/^[-*+]\s+/gm, '') // unordered lists
    .replace(/^\d+\.\s+/gm, '') // ordered lists
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // links
    .replace(/!\[.*?\]\(.+?\)/g, '') // images
}

// ─── Vehicle/Deal helpers ───

import type { Deal, DealState, Vehicle } from '@/lib/types'

/** Get all vehicles with role 'primary' (being considered for purchase). */
export function getPrimaryVehicles(vehicles: Vehicle[]): Vehicle[] {
  return vehicles.filter((v) => v.role === 'primary')
}

/** Get the trade-in vehicle, or null if none. */
export function getTradeInVehicle(vehicles: Vehicle[]): Vehicle | null {
  return vehicles.find((v) => v.role === 'trade_in') ?? null
}

/** Get the active deal from deal state, or null if none. */
export function getActiveDeal(dealState: DealState): Deal | null {
  if (!dealState.activeDealId) return null
  return dealState.deals.find((d) => d.id === dealState.activeDealId) ?? null
}

/** Get all deals for a specific vehicle. */
export function getDealsForVehicle(deals: Deal[], vehicleId: string): Deal[] {
  return deals.filter((d) => d.vehicleId === vehicleId)
}

/** Get the vehicle associated with a deal. */
export function getVehicleForDeal(vehicles: Vehicle[], deal: Deal): Vehicle | null {
  return vehicles.find((v) => v.id === deal.vehicleId) ?? null
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
