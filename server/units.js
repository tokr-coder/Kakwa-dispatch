const FACTORS = {
  area: 0.09290304,
  sand: 0.764554858,
  snow: 2.54,
}

export const SAND_STEPS_YARDS = [0.5, 0.75, 1, 1.25, 1.5]

export function unitsOf(settings) {
  return settings.units === 'metric' ? 'metric' : 'imperial'
}

export function toDisplay(kind, imperialValue, units) {
  if (imperialValue == null || imperialValue === '') return null
  const value = Number(imperialValue)
  if (units !== 'metric') return round(value)
  return round(value * FACTORS[kind])
}

export function fromDisplay(kind, displayValue, units) {
  if (displayValue == null || displayValue === '') return null
  const value = Number(displayValue)
  if (!Number.isFinite(value)) return null
  if (units !== 'metric') return value
  return value / FACTORS[kind]
}

export function unitLabel(kind, units) {
  const metric = units === 'metric'
  if (kind === 'area') return metric ? 'm²' : 'sq ft'
  if (kind === 'sand') return metric ? 'm³' : 'yd'
  if (kind === 'snow') return metric ? 'cm' : 'in'
  return ''
}

export function formatMeasure(kind, imperialValue, units) {
  if (imperialValue == null || imperialValue === '') return ''
  return `${toDisplay(kind, imperialValue, units)} ${unitLabel(kind, units)}`
}

function round(value) {
  return Math.round(value * 100) / 100
}
