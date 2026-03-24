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

export function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
