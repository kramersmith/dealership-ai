/** Elapsed time since session start for the SESSION timer (HH:MM:SS, 24h cap display). */
export function formatSessionElapsed(isoStartedAt: string, nowMs: number): string {
  const start = Date.parse(isoStartedAt)
  if (!Number.isFinite(start)) return '00:00:00'
  const elapsedSec = Math.max(0, Math.floor((nowMs - start) / 1000))
  const h = Math.floor(elapsedSec / 3600)
  const m = Math.floor((elapsedSec % 3600) / 60)
  const s = elapsedSec % 60
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n))
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}
