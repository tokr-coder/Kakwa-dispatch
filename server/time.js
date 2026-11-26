export const ZONE = 'America/Edmonton'

export function zonedDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function addDays(iso, days) {
  const [year, month, day] = iso.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  return next.toISOString().slice(0, 10)
}

export function parseTime(value) {
  if (value == null || value === '') return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

export function formatTime(minutes) {
  if (minutes == null) return ''
  const hour = Math.floor(minutes / 60) % 24
  const minute = minutes % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function labelTime(minutes) {
  if (minutes == null) return ''
  const hour24 = Math.floor(minutes / 60) % 24
  const minute = minutes % 60
  const suffix = hour24 >= 12 ? 'PM' : 'AM'
  const hour = hour24 % 12 || 12
  return `${hour}:${String(minute).padStart(2, '0')} ${suffix}`
}

export function labelWhen(iso) {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function nowIso() {
  return new Date().toISOString()
}

export function hoursBetween(startIso, endIso) {
  if (!startIso || !endIso) return 0
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.round((ms / 36e5) * 100) / 100
}
