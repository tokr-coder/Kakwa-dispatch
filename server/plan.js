import { randomUUID } from 'node:crypto'
import { HttpError } from './errors.js'
import { hashPassword } from './passwords.js'
import { addDays, formatTime, hoursBetween, labelTime, nowIso, parseTime } from './time.js'
import { formatMeasure, fromDisplay, SAND_STEPS_YARDS, toDisplay, unitLabel, unitsOf } from './units.js'
import { workflowById, workflows } from './workflows.js'

const TAG = { pushing: 'push_tag', sanding: 'sand_tag', hauling: 'haul_tag' }
const MACHINE_TYPE = { pushing: 'loader', sanding: 'sander', hauling: 'haul_truck' }

export function getSettings(db) {
  const rows = db.prepare('SELECT `key`, `value` FROM settings').all()
  const raw = Object.fromEntries(rows.map((row) => [row.key, row.value]))
  const units = raw.units === 'metric' ? 'metric' : 'imperial'
  return {
    units,
    machineAssignment: raw.machine_assignment === '1',
    snowThreshold: toDisplay('snow', Number(raw.snow_threshold_inches || 2), units),
    snowUnit: unitLabel('snow', units),
    vapidPublic: raw.vapid_public || '',
  }
}

export function saveSettings(db, patch) {
  const current = db.prepare('SELECT `key`, `value` FROM settings').all()
  const raw = Object.fromEntries(current.map((row) => [row.key, row.value]))
  const units = patch.units === 'metric' || patch.units === 'imperial' ? patch.units : raw.units
  if (patch.units) db.prepare('UPDATE settings SET `value` = ? WHERE `key` = ?').run(units, 'units')
  if (patch.machineAssignment != null) {
    db.prepare('UPDATE settings SET `value` = ? WHERE `key` = ?').run(patch.machineAssignment ? '1' : '0', 'machine_assignment')
  }
  if (patch.snowThreshold != null && patch.snowThreshold !== '') {
    const inches = fromDisplay('snow', Number(patch.snowThreshold), units)
    if (!Number.isFinite(inches) || inches < 0) throw new HttpError(400, 'Enter a snow amount.')
    db.prepare('UPDATE settings SET `value` = ? WHERE `key` = ?').run(String(inches), 'snow_threshold_inches')
  }
  return getSettings(db)
}

export function listWorkflows() {
  return workflows
}

export function getPlan(db, date) {
  const day = db.prepare('SELECT * FROM days WHERE work_date = ?').get(date)
  const settings = getSettings(db)
  const previous = db.prepare('SELECT work_date FROM days WHERE work_date < ? ORDER BY work_date DESC LIMIT 1').get(date)
  return {
    date,
    day: day ? publicDay(db, day, settings) : null,
    stops: day ? stopsFor(db, day.id).map((stop) => publicStop(db, stop, settings)) : [],
    workflows,
    settings: publicSettings(settings),
    hasPrevious: Boolean(previous),
    sandSteps: SAND_STEPS_YARDS.map((yards) => ({
      yards,
      label: formatMeasure('sand', yards, settings.units),
    })),
  }
}

function publicSettings(settings) {
  return {
    units: settings.units,
    machineAssignment: settings.machineAssignment,
    snowThreshold: settings.snowThreshold,
    snowUnit: settings.snowUnit,
    vapidPublic: settings.vapidPublic,
  }
}

function publicDay(db, day, settings) {
  return {
    id: day.id,
    date: day.work_date,
    weatherNote: day.weather_note || '',
    snow: day.snow_inches == null ? null : formatMeasure('snow', day.snow_inches, settings.units),
    triggerAt: day.trigger_at,
    triggerResult: day.trigger_result,
  }
}

export function stopsFor(db, dayId, workflow) {
  const rows = workflow
    ? db.prepare('SELECT * FROM stops WHERE day_id = ? AND workflow = ? ORDER BY window_start, sort_order').all(dayId, workflow)
    : db.prepare('SELECT * FROM stops WHERE day_id = ? ORDER BY workflow, window_start, sort_order').all(dayId)
  return rows
}

function crewFor(db, stopId) {
  return db.prepare(`SELECT crew.*, operators.label AS operator_label, operators.experience, operators.notify_job_edges,
      machines.code AS machine_code, machines.type AS machine_type
    FROM crew
    JOIN operators ON operators.id = crew.operator_id
    LEFT JOIN machines ON machines.id = crew.machine_id
    WHERE crew.stop_id = ?
    ORDER BY crew.sort_order`).all(stopId)
}

export function publicStop(db, stop, settings = getSettings(db)) {
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(stop.site_id)
  const from = stop.from_site_id ? db.prepare('SELECT * FROM sites WHERE id = ?').get(stop.from_site_id) : null
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(site.client_id)
  return {
    id: stop.id,
    workflow: stop.workflow,
    siteId: site.id,
    siteName: site.name,
    address: site.address,
    clientName: client.name,
    billing: client.billing,
    windowStart: formatTime(stop.window_start),
    windowEnd: formatTime(stop.window_end),
    windowLabel: `${labelTime(stop.window_start)}–${labelTime(stop.window_end)}`,
    releaseAt: formatTime(stop.release_at),
    releaseLabel: stop.release_at == null ? '' : labelTime(stop.release_at),
    status: stop.status,
    holdReason: stop.hold_reason || '',
    releasedStart: formatTime(stop.released_start),
    fromSiteId: from?.id || '',
    fromSiteName: from?.name || '',
    travelMinutes: stop.travel_minutes,
    loadMinutes: stop.load_minutes,
    unloadMinutes: stop.unload_minutes,
    overrunMinutes: stop.overrun_minutes,
    loads: stop.loads,
    driverNote: stop.driver_note || '',
    hazards: site.hazards || '',
    notes: site.notes || '',
    areaLabel: formatMeasure('area', site.area_sqft, settings.units),
    sandLabel: formatMeasure('sand', site.default_sand_yards, settings.units),
    bylawLabel: site.bylaw_earliest == null ? '' : labelTime(site.bylaw_earliest),
    tags: tagsFor(site),
    crew: crewFor(db, stop.id).map((seat) => ({
      id: seat.id,
      operatorId: seat.operator_id,
      operatorLabel: seat.operator_label,
      experience: seat.experience,
      machineId: seat.machine_id || '',
      machineCode: seat.machine_code || '',
      machineType: seat.machine_type || '',
    })),
  }
}

function tagsFor(site) {
  return [
    tag('pushing', site.push_tag),
    tag('sanding', site.sand_tag),
    tag('hauling', site.haul_tag),
  ].filter(Boolean)
}

function tag(service, value) {
  if (!value || value === 'off') return null
  return { service, mode: value }
}

export function pairingWarning(db, operatorIds) {
  if (operatorIds.length < 2) return ''
  const rows = operatorIds.map((id) => db.prepare('SELECT * FROM operators WHERE id = ?').get(id))
  if (rows.some((row) => row?.experience === 'experienced')) return ''
  return 'This site has no experienced lead.'
}

export function choices(db, { date, workflow, windowStart, windowEnd, releaseAt, ignoreStopId }) {
  const start = parseTime(windowStart)
  const end = parseTime(windowEnd)
  if (start == null || end == null || end <= start) throw new HttpError(400, 'Enter a start and an end.')
  const release = parseTime(releaseAt)
  const day = db.prepare('SELECT * FROM days WHERE work_date = ?').get(date)
  const stops = day ? stopsFor(db, day.id).filter((stop) => stop.id !== ignoreStopId) : []
  const window = { start, end, release }
  const operators = db.prepare('SELECT * FROM operators WHERE active = 1 ORDER BY label').all().map((operator) => ({
    ...operatorChoice(db, operator, workflow, window, stops),
    id: operator.id,
    label: operator.label,
    experience: operator.experience,
    usualMachineId: operator.usual_machine_id || '',
  }))
  const machines = db.prepare('SELECT * FROM machines WHERE active = 1 ORDER BY code').all().map((machine) => ({
    ...machineChoice(machine, workflow, window, stops, db),
    id: machine.id,
    code: machine.code,
    type: machine.type,
    implement: machine.implement || '',
    usualFor: db.prepare('SELECT label FROM operators WHERE usual_machine_id = ? AND active = 1').all(machine.id).map((row) => row.label),
  }))
  operators.sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.label.localeCompare(b.label))
  return { operators, machines, warning: '' }
}

function operatorChoice(db, operator, workflow, window, stops) {
  const hasSeat = (stop) => crewFor(db, stop.id).some((seat) => seat.operator_id === operator.id)
  const suggested = suggestedOperator(operator, workflow)
  if (workflow === 'sanding') {
    return { state: 'free', where: alsoOn(db, stops, window, hasSeat), suggested }
  }
  const hit = stops.find((stop) => seatBlocked(stop, window, hasSeat))
  if (!hit) return { state: comingFrom(db, stops, window.start, hasSeat) ? 'coming' : 'free', where: comingFrom(db, stops, window.start, hasSeat), suggested }
  return { state: 'taken', where: siteName(db, hit.site_id), suggested }
}

function machineChoice(machine, workflow, window, stops, db) {
  if (machine.type !== MACHINE_TYPE[workflow]) return { state: 'unneeded', where: '', suggested: false }
  const hasSeat = (stop) => crewFor(db, stop.id).some((seat) => seat.machine_id === machine.id)
  if (machine.type === 'sander') return { state: 'free', where: alsoOn(db, stops, window, hasSeat), suggested: false }
  const hit = stops.find((stop) => seatBlocked(stop, window, hasSeat))
  if (!hit) return { state: comingFrom(db, stops, window.start, hasSeat) ? 'coming' : 'free', where: comingFrom(db, stops, window.start, hasSeat), suggested: false }
  return { state: 'taken', where: siteName(db, hit.site_id), suggested: false }
}

function seatBlocked(stop, window, hasSeat) {
  if (!hasSeat(stop) || !rangesOverlap(window, span(stop))) return false
  if (releaseCovers(stop, window.start)) return false
  if (window.release != null && window.start < stop.window_start && window.release <= stop.window_start) return false
  return true
}

function suggestedOperator(operator, workflow) {
  const usual = operator.usual_machine_id || ''
  if (workflow === 'pushing') return usual.startsWith('ld-')
  if (workflow === 'sanding') return usual.startsWith('st-')
  if (workflow === 'hauling') return usual.startsWith('ht-')
  return false
}

function comingFrom(db, stops, start, hasSeat) {
  const prior = stops
    .filter((stop) => hasSeat(stop) && (stop.window_end <= start || (stop.release_at != null && stop.release_at <= start)))
    .sort((a, b) => b.window_start - a.window_start)[0]
  return prior ? siteName(db, prior.site_id) : ''
}

function alsoOn(db, stops, window, hasSeat) {
  const names = stops
    .filter((stop) => rangesOverlap(window, span(stop)) && hasSeat(stop))
    .map((stop) => siteName(db, stop.site_id))
  return names.join(', ')
}

function span(stop) {
  return { start: stop.window_start, end: stop.window_end }
}

function rangesOverlap(a, b) {
  return a.start < b.end && b.start < a.end
}

function releaseCovers(earlier, laterStart) {
  return earlier.window_start < laterStart && earlier.release_at != null && earlier.release_at <= laterStart
}

function siteName(db, id) {
  return db.prepare('SELECT name FROM sites WHERE id = ?').get(id)?.name || 'that site'
}

export function createStop(db, input) {
  const workflow = workflowById(input.workflow)
  if (!workflow) throw new HttpError(400, 'Unknown workflow.')
  const site = db.prepare('SELECT * FROM sites WHERE id = ? AND active = 1').get(input.siteId)
  if (!site) throw new HttpError(400, 'Pick a site.')
  if (site[TAG[workflow.id]] === 'off') throw new HttpError(400, `${site.name} does not take ${workflow.label.toLowerCase()}.`)
  const start = parseTime(input.windowStart)
  let end = parseTime(input.windowEnd)
  if (start == null) throw new HttpError(400, 'Enter a start time.')
  if (site.bylaw_earliest != null && start < site.bylaw_earliest) {
    throw new HttpError(400, `${site.name} cannot start before ${labelTime(site.bylaw_earliest)}.`)
  }
  let travel = null
  let load = null
  let unload = null
  let fromSite = null
  if (workflow.id === 'hauling') {
    fromSite = db.prepare('SELECT * FROM sites WHERE id = ?').get(input.fromSiteId)
    if (!fromSite) throw new HttpError(400, 'Pick the site the truck leaves.')
    travel = Number(input.travelMinutes)
    load = Number(input.loadMinutes)
    unload = Number(input.unloadMinutes)
    if (![travel, load, unload].every((value) => Number.isFinite(value) && value >= 0)) {
      throw new HttpError(400, 'Enter the travel time and the load and unload buffers.')
    }
    end = start + load + travel + unload
  }
  if (end == null || end <= start) throw new HttpError(400, 'The end time has to be after the start.')
  const releaseAt = parseTime(input.releaseAt)
  if (input.releaseAt && releaseAt == null) throw new HttpError(400, 'Enter the leave time as HH:MM.')
  const operatorIds = [...new Set(input.operatorIds || [])]
  if (!operatorIds.length) throw new HttpError(400, 'Pick at least one operator.')
  const settings = getSettings(db)
  const machines = input.machines || {}
  if (!settings.machineAssignment) {
    for (const id of operatorIds) machines[id] = null
  }
  const day = ensureDay(db, input.date)
  if (stopsFor(db, day.id, workflow.id).some((stop) => stop.site_id === site.id && workflow.id !== 'hauling')) {
    throw new HttpError(400, `${site.name} is already on this ${workflow.label.toLowerCase()} plan.`)
  }
  const stopId = randomUUID()
  const sort = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS value FROM stops WHERE day_id = ? AND workflow = ?').get(day.id, workflow.id).value) + 1
  db.exec('BEGIN')
  try {
    db.prepare(`INSERT INTO stops
      (id, day_id, workflow, site_id, from_site_id, sort_order, window_start, window_end, release_at, status, travel_minutes, load_minutes, unload_minutes, overrun_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, 0)`).run(
      stopId, day.id, workflow.id, site.id, fromSite?.id || null, sort, start, end, releaseAt, travel, load, unload,
    )
    operatorIds.forEach((operatorId, index) => {
      const operator = db.prepare('SELECT * FROM operators WHERE id = ? AND active = 1').get(operatorId)
      if (!operator) throw new HttpError(400, 'That operator is not on the crew list.')
      const machineId = machines[operatorId] || null
      if (machineId) assertMachineFits(db, machineId, workflow.id)
      db.prepare('INSERT INTO crew (id, stop_id, operator_id, machine_id, sort_order) VALUES (?, ?, ?, ?, ?)').run(
        randomUUID(), stopId, operatorId, machineId, index + 1,
      )
    })
    const message = conflictMessage(db, day.id)
    if (message) throw new HttpError(400, message)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return {
    stop: publicStop(db, db.prepare('SELECT * FROM stops WHERE id = ?').get(stopId)),
    warning: pairingWarning(db, operatorIds),
  }
}

function assertMachineFits(db, machineId, workflow) {
  const machine = db.prepare('SELECT * FROM machines WHERE id = ? AND active = 1').get(machineId)
  if (!machine) throw new HttpError(400, 'That machine is not in the fleet.')
  if (machine.type !== MACHINE_TYPE[workflow]) throw new HttpError(400, `${machine.code} is not used for this work.`)
}

function ensureDay(db, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new HttpError(400, 'Pick a date.')
  let day = db.prepare('SELECT * FROM days WHERE work_date = ?').get(date)
  if (!day) {
    const id = randomUUID()
    db.prepare('INSERT INTO days (id, work_date) VALUES (?, ?)').run(id, date)
    day = db.prepare('SELECT * FROM days WHERE id = ?').get(id)
  }
  return day
}

export function conflictMessage(db, dayId) {
  const stops = stopsFor(db, dayId)
  for (const stop of stops) {
    const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(stop.site_id)
    if (site.bylaw_earliest != null && stop.window_start < site.bylaw_earliest) {
      return `${site.name} cannot start before ${labelTime(site.bylaw_earliest)}.`
    }
  }
  for (let i = 0; i < stops.length; i += 1) {
    for (let j = i + 1; j < stops.length; j += 1) {
      const a = stops[i]
      const b = stops[j]
      if (!rangesOverlap(span(a), span(b))) continue
      const earlier = a.window_start <= b.window_start ? a : b
      const later = earlier === a ? b : a
      const covered = releaseCovers(earlier, later.window_start)
      const seatsA = crewFor(db, a.id)
      const seatsB = crewFor(db, b.id)
      for (const seat of seatsA) {
        const other = seatsB.find((item) => item.operator_id === seat.operator_id)
        if (!other) continue
        if (a.workflow === 'sanding' && b.workflow === 'sanding') continue
        if (covered) continue
        return `${seat.operator_label} is already on ${siteName(db, other.stop_id === b.id ? b.site_id : a.site_id)} in that window.`
      }
      for (const seat of seatsA) {
        if (!seat.machine_id) continue
        const other = seatsB.find((item) => item.machine_id === seat.machine_id)
        if (!other) continue
        if (seat.machine_type === 'sander') continue
        if (covered) continue
        const where = siteName(db, other.stop_id === b.id ? b.site_id : a.site_id)
        return `${seat.machine_code} is already on ${where} in that window.`
      }
    }
  }
  return ''
}

export function moveStop(db, stopId, direction) {
  const stop = mustStop(db, stopId)
  const siblings = stopsFor(db, stop.day_id, stop.workflow)
  const index = siblings.findIndex((item) => item.id === stopId)
  const next = index + direction
  if (next < 0 || next >= siblings.length) throw new HttpError(400, 'That stop is already at the end of the list.')
  const other = siblings[next]
  const snapshot = [stop, other].map((item) => ({ ...item }))
  db.exec('BEGIN')
  try {
    if (stop.workflow === 'hauling') swapDepartures(db, stop, other)
    else swapWindows(db, stop, other)
    const message = conflictMessage(db, stop.day_id)
    if (message) throw new HttpError(400, message)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    for (const item of snapshot) {
      db.prepare('UPDATE stops SET window_start = ?, window_end = ?, sort_order = ? WHERE id = ?').run(item.window_start, item.window_end, item.sort_order, item.id)
    }
    throw error
  }
  return publicStop(db, mustStop(db, stopId))
}

function swapWindows(db, a, b) {
  db.prepare('UPDATE stops SET window_start = ?, window_end = ?, sort_order = ? WHERE id = ?').run(b.window_start, b.window_end, b.sort_order, a.id)
  db.prepare('UPDATE stops SET window_start = ?, window_end = ?, sort_order = ? WHERE id = ?').run(a.window_start, a.window_end, a.sort_order, b.id)
}

function swapDepartures(db, a, b) {
  const aEnd = b.window_start + (a.load_minutes || 0) + (a.travel_minutes || 0) + (a.unload_minutes || 0) + (a.overrun_minutes || 0)
  const bEnd = a.window_start + (b.load_minutes || 0) + (b.travel_minutes || 0) + (b.unload_minutes || 0) + (b.overrun_minutes || 0)
  db.prepare('UPDATE stops SET window_start = ?, window_end = ?, sort_order = ? WHERE id = ?').run(b.window_start, aEnd, b.sort_order, a.id)
  db.prepare('UPDATE stops SET window_start = ?, window_end = ?, sort_order = ? WHERE id = ?').run(a.window_start, bEnd, a.sort_order, b.id)
}

export function removeStop(db, stopId) {
  const stop = mustStop(db, stopId)
  if (stop.status !== 'planned') throw new HttpError(400, 'That stop has already been released. Move it instead of deleting it.')
  db.prepare('DELETE FROM crew WHERE stop_id = ?').run(stopId)
  db.prepare('DELETE FROM stops WHERE id = ?').run(stopId)
}

export function setNote(db, stopId, note) {
  mustStop(db, stopId)
  db.prepare('UPDATE stops SET driver_note = ? WHERE id = ?').run(String(note || '').slice(0, 280), stopId)
  return publicStop(db, mustStop(db, stopId))
}

export function runLong(db, stopId, minutes) {
  const extra = Number(minutes)
  if (!Number.isFinite(extra) || extra <= 0) throw new HttpError(400, 'Enter how many minutes it ran long.')
  const stop = mustStop(db, stopId)
  const originalEnd = stop.window_end
  const seats = crewFor(db, stop.id)
  const snapshot = stopsFor(db, stop.day_id).map((item) => ({ ...item }))
  db.exec('BEGIN')
  try {
    db.prepare('UPDATE stops SET window_end = ?, overrun_minutes = overrun_minutes + ? WHERE id = ?').run(originalEnd + extra, extra, stop.id)
    for (const later of stopsFor(db, stop.day_id)) {
      if (later.id === stop.id || later.window_start < originalEnd) continue
      const laterSeats = crewFor(db, later.id)
      const shares = laterSeats.some((seat) => seats.some((own) => own.operator_id === seat.operator_id || (own.machine_id && own.machine_id === seat.machine_id && own.machine_type !== 'sander')))
      if (!shares) continue
      db.prepare('UPDATE stops SET window_start = ?, window_end = ? WHERE id = ?').run(later.window_start + extra, later.window_end + extra, later.id)
    }
    const message = conflictMessage(db, stop.day_id)
    if (message) throw new HttpError(400, message)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    for (const item of snapshot) {
      db.prepare('UPDATE stops SET window_start = ?, window_end = ?, overrun_minutes = ? WHERE id = ?').run(item.window_start, item.window_end, item.overrun_minutes, item.id)
    }
    throw error
  }
  return stopsFor(db, stop.day_id).map((item) => publicStop(db, item))
}

export function switchSite(db, { stopId, operatorId, siteId, windowStart, reason }) {
  const stop = mustStop(db, stopId)
  const workflow = workflowById(stop.workflow)
  const site = db.prepare('SELECT * FROM sites WHERE id = ? AND active = 1').get(siteId)
  if (!site) throw new HttpError(400, 'Pick the next site.')
  if (site[TAG[stop.workflow]] === 'off') throw new HttpError(400, `${site.name} does not take ${workflow.label.toLowerCase()}.`)
  const start = parseTime(windowStart)
  if (start == null) throw new HttpError(400, 'Enter the new start time.')
  if (site.bylaw_earliest != null && start < site.bylaw_earliest) {
    throw new HttpError(400, `${site.name} cannot start before ${labelTime(site.bylaw_earliest)}.`)
  }
  const seats = crewFor(db, stop.id)
  const seat = seats.find((item) => item.operator_id === operatorId)
  if (!seat) throw new HttpError(400, 'That operator is not on this stop.')
  const duration = Math.max(30, stop.window_end - stop.window_start)
  const day = db.prepare('SELECT * FROM days WHERE id = ?').get(stop.day_id)
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM crew WHERE id = ?').run(seat.id)
    const remaining = crewFor(db, stop.id)
    if (!remaining.length) {
      db.prepare(`UPDATE stops SET window_end = ?, status = 'done' WHERE id = ?`).run(Math.min(stop.window_end, start), stop.id)
    }
    const newId = randomUUID()
    db.prepare(`INSERT INTO stops
      (id, day_id, workflow, site_id, from_site_id, sort_order, window_start, window_end, status, overrun_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'go', 0)`).run(
      newId, stop.day_id, stop.workflow, site.id, stop.workflow === 'hauling' ? stop.site_id : null,
      99, start, start + duration,
    )
    db.prepare('INSERT INTO crew (id, stop_id, operator_id, machine_id, sort_order) VALUES (?, ?, ?, ?, 1)').run(
      randomUUID(), newId, operatorId, seat.machine_id,
    )
    const message = conflictMessage(db, stop.day_id)
    if (message) throw new HttpError(400, message)
    const text = `Go. ${workflow.label} at ${site.name}. Start ${labelTime(start)}. ${reason || 'Plan changed.'}`.replace(/\s+/g, ' ').trim()
    notifyOperator(db, day, operatorId, 'switch', text)
    db.exec('COMMIT')
    return publicStop(db, mustStop(db, newId))
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function copyPrevious(db, date) {
  const previous = db.prepare('SELECT * FROM days WHERE work_date < ? ORDER BY work_date DESC LIMIT 1').get(date)
  if (!previous) throw new HttpError(400, 'There is no earlier plan to copy.')
  const existing = db.prepare('SELECT * FROM days WHERE work_date = ?').get(date)
  if (existing && stopsFor(db, existing.id).length) throw new HttpError(400, 'This day already has a plan.')
  const day = ensureDay(db, date)
  db.exec('BEGIN')
  try {
    for (const stop of stopsFor(db, previous.id)) {
      const id = randomUUID()
      db.prepare(`INSERT INTO stops
        (id, day_id, workflow, site_id, from_site_id, sort_order, window_start, window_end, release_at, status, travel_minutes, load_minutes, unload_minutes, overrun_minutes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, 0)`).run(
        id, day.id, stop.workflow, stop.site_id, stop.from_site_id, stop.sort_order, stop.window_start, stop.window_end, stop.release_at, stop.travel_minutes, stop.load_minutes, stop.unload_minutes,
      )
      for (const seat of crewFor(db, stop.id)) {
        db.prepare('INSERT INTO crew (id, stop_id, operator_id, machine_id, sort_order) VALUES (?, ?, ?, ?, ?)').run(
          randomUUID(), id, seat.operator_id, seat.machine_id, seat.sort_order,
        )
      }
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return getPlan(db, date)
}

export function pullTrigger(db, date, snowDisplay) {
  const settings = getSettings(db)
  const inches = fromDisplay('snow', Number(snowDisplay), settings.units)
  if (!Number.isFinite(inches) || inches < 0) throw new HttpError(400, 'Enter how much snow has fallen.')
  const day = ensureDay(db, date)
  const threshold = Number(db.prepare('SELECT `value` FROM settings WHERE `key` = ?').get('snow_threshold_inches').value)
  db.prepare('UPDATE days SET snow_inches = ?, trigger_at = ?, trigger_result = ? WHERE id = ?').run(
    inches, nowIso(), inches < threshold ? 'no_go' : 'go', day.id,
  )
  const operators = new Map()
  for (const stop of stopsFor(db, day.id)) {
    for (const seat of crewFor(db, stop.id)) operators.set(seat.operator_id, seat)
  }
  const messages = []
  if (inches < threshold) {
    const body = `Hold. Snow is under the go threshold (${formatMeasure('snow', threshold, settings.units)}). No release.`
    for (const operatorId of operators.keys()) messages.push(...notifyOperator(db, day, operatorId, 'hold', body))
    return { result: 'no_go', messages: messages.map(publicMessage) }
  }
  for (const stop of stopsFor(db, day.id).filter((item) => item.workflow !== 'sanding')) {
    const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(stop.site_id)
    const workflow = workflowById(stop.workflow)
    if (site.bylaw_earliest != null && stop.window_start < site.bylaw_earliest) {
      const reason = `Noise bylaw: not before ${labelTime(site.bylaw_earliest)}. Updated slot ${labelTime(site.bylaw_earliest)}–${labelTime(stop.window_end)}.`
      db.prepare(`UPDATE stops SET status = 'hold', hold_reason = ?, released_start = ? WHERE id = ?`).run(reason, site.bylaw_earliest, stop.id)
      const body = `Hold. ${workflow.label} at ${site.name}. ${reason}`
      for (const seat of crewFor(db, stop.id)) messages.push(...notifyOperator(db, day, seat.operator_id, 'hold', body))
    } else {
      db.prepare(`UPDATE stops SET status = 'go', hold_reason = '', released_start = ? WHERE id = ?`).run(stop.window_start, stop.id)
      const leave = stop.release_at == null ? '' : ` Leave for the next site at ${labelTime(stop.release_at)}.`
      const from = stop.from_site_id ? ` From ${siteName(db, stop.from_site_id)}.` : ''
      const body = `Go. ${workflow.label} at ${site.name}. Start ${labelTime(stop.window_start)}.${from}${leave}`
      for (const seat of crewFor(db, stop.id)) messages.push(...notifyOperator(db, day, seat.operator_id, 'go', body))
    }
  }
  const sanding = stopsFor(db, day.id, 'sanding')
  const byOperator = new Map()
  for (const stop of sanding) {
    for (const seat of crewFor(db, stop.id)) {
      const list = byOperator.get(seat.operator_id) || []
      list.push(stop)
      byOperator.set(seat.operator_id, list)
    }
  }
  for (const [operatorId, list] of byOperator) {
    const parts = list.map((stop) => {
      const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(stop.site_id)
      if (site.bylaw_earliest != null && stop.window_start < site.bylaw_earliest) {
        db.prepare(`UPDATE stops SET status = 'hold', hold_reason = ?, released_start = ? WHERE id = ?`).run(
          `Noise bylaw: not before ${labelTime(site.bylaw_earliest)}.`, site.bylaw_earliest, stop.id,
        )
        return `${site.name} hold until ${labelTime(site.bylaw_earliest)}`
      }
      db.prepare(`UPDATE stops SET status = 'go', released_start = ? WHERE id = ?`).run(stop.window_start, stop.id)
      return `${site.name} ${labelTime(stop.window_start)}–${labelTime(stop.window_end)}`
    })
    const body = `Go. Sanding, in order: ${parts.join('; ')}.`
    messages.push(...notifyOperator(db, day, operatorId, 'go', body))
  }
  return { result: 'go', messages: messages.map(publicMessage) }
}

function notifyOperator(db, day, operatorId, kind, body) {
  const operator = db.prepare('SELECT * FROM operators WHERE id = ?').get(operatorId)
  const user = db.prepare('SELECT * FROM users WHERE operator_id = ?').get(operatorId)
  const rows = []
  for (const channel of ['sms', 'push']) {
    const id = randomUUID()
    db.prepare(`INSERT INTO messages
      (id, day_id, user_id, operator_id, channel, kind, body, simulated, delivered, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?)`).run(id, day?.id || null, user?.id || null, operatorId, channel, kind, body, nowIso())
    rows.push(db.prepare('SELECT * FROM messages WHERE id = ?').get(id))
  }
  return rows
}

function publicMessage(row) {
  return {
    id: row.id,
    channel: row.channel,
    kind: row.kind,
    body: row.body,
    simulated: true,
    delivered: false,
    createdAt: row.created_at,
    operatorId: row.operator_id,
  }
}

export function listMessages(db, date) {
  const day = db.prepare('SELECT * FROM days WHERE work_date = ?').get(date)
  if (!day) return []
  return db.prepare('SELECT * FROM messages WHERE day_id = ? ORDER BY created_at').all(day.id).map(publicMessage)
}

function maybeJobEdge(db, day, operator, kind, body) {
  if (operator.notify_job_edges !== 1) return []
  return notifyOperator(db, day, operator.id, kind, body)
}

export function clock(db, { stopId, operatorId, edge }) {
  const stop = mustStop(db, stopId)
  const seat = crewFor(db, stop.id).find((item) => item.operator_id === operatorId)
  if (!seat) throw new HttpError(403, 'This stop is not on your list.')
  const day = db.prepare('SELECT * FROM days WHERE id = ?').get(stop.day_id)
  let ticket = db.prepare('SELECT * FROM tickets WHERE day_id = ? AND site_id = ? AND workflow = ?').get(day.id, stop.site_id, stop.workflow)
  if (!ticket) {
    const id = randomUUID()
    db.prepare(`INSERT INTO tickets (id, day_id, site_id, workflow, stop_id, work_done, loads)
      VALUES (?, ?, ?, ?, ?, ?, 0)`).run(id, day.id, stop.site_id, stop.workflow, stop.id, workflowById(stop.workflow).label)
    ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id)
  }
  const order = ['clock_in', 'clock_out', 'clock_in_2', 'clock_out_2']
  const column = { in: 'clock_in', out: 'clock_out', in2: 'clock_in_2', out2: 'clock_out_2' }[edge]
  if (!column) throw new HttpError(400, 'Unknown clock action.')
  const index = order.indexOf(column)
  if (ticket[column]) return publicTicket(db, ticket)
  if (index > 0 && !ticket[order[index - 1]]) throw new HttpError(400, 'Clock the earlier time first.')
  const stamp = nowIso()
  db.prepare(`UPDATE tickets SET ${column} = ? WHERE id = ?`).run(stamp, ticket.id)
  if (column === 'clock_out' || column === 'clock_out_2') {
    db.prepare(`UPDATE stops SET status = 'done' WHERE id = ?`).run(stop.id)
  }
  const operator = db.prepare('SELECT * FROM operators WHERE id = ?').get(operatorId)
  const site = siteName(db, stop.site_id)
  const kind = column.startsWith('clock_in') ? 'job_start' : 'job_end'
  const body = column.startsWith('clock_in') ? `Job started at ${site}.` : `Job ended at ${site}.`
  maybeJobEdge(db, day, operator, kind, body)
  return publicTicket(db, db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket.id))
}

export function startMeter(db, { stopId, operatorId, machineId, readings }) {
  const stop = mustStop(db, stopId)
  const seat = crewFor(db, stop.id).find((item) => item.operator_id === operatorId)
  if (!seat) throw new HttpError(403, 'This stop is not on your list.')
  const machine = db.prepare('SELECT * FROM machines WHERE id = ? AND active = 1').get(machineId)
  if (!machine) throw new HttpError(400, 'Pick a machine.')
  if (machine.type !== MACHINE_TYPE[stop.workflow]) throw new HttpError(400, `${machine.code} is not used for this work.`)
  if (seat.machine_id && seat.machine_id !== machine.id) {
    throw new HttpError(400, 'Use the breakdown swap to change machines mid-shift.')
  }
  const open = db.prepare(`SELECT * FROM meter_stints WHERE operator_id = ? AND machine_id = ? AND end_reading IS NULL`).get(operatorId, machine.id)
  if (open) throw new HttpError(400, 'Finish the open meter reading first.')
  const day = db.prepare('SELECT * FROM days WHERE id = ?').get(stop.day_id)
  let ticket = db.prepare('SELECT * FROM tickets WHERE day_id = ? AND site_id = ? AND workflow = ?').get(day.id, stop.site_id, stop.workflow)
  if (!ticket) {
    clock(db, { stopId, operatorId, edge: 'in' })
    ticket = db.prepare('SELECT * FROM tickets WHERE day_id = ? AND site_id = ? AND workflow = ?').get(day.id, stop.site_id, stop.workflow)
  }
  const created = []
  for (const meter of ['hours', 'km']) {
    const flag = meter === 'hours' ? machine.track_hours : machine.track_km
    if (flag == null) throw new HttpError(400, `${meter === 'hours' ? 'Hour' : 'Kilometre'} tracking for ${machine.code} is not confirmed.`)
    if (flag !== 1) continue
    const reading = Number(readings?.[meter])
    const last = meter === 'hours' ? machine.last_hours : machine.last_km
    if (!Number.isFinite(reading)) throw new HttpError(400, `Enter the starting ${meter === 'hours' ? 'hour' : 'kilometre'} reading.`)
    if (last != null && reading < last) throw new HttpError(400, `That reading is below the last meter (${last}).`)
    db.prepare(`INSERT INTO meter_stints
      (id, ticket_id, machine_id, operator_id, meter, start_reading, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), ticket.id, machine.id, operatorId, meter, reading, nowIso())
    created.push(meter)
  }
  if (!created.length) throw new HttpError(400, `${machine.code} has no confirmed meter to record.`)
  if (!seat.machine_id) db.prepare('UPDATE crew SET machine_id = ? WHERE id = ?').run(machine.id, seat.id)
  return publicTicket(db, db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket.id))
}

export function endMeter(db, { stopId, operatorId, machineId, readings }) {
  const stop = mustStop(db, stopId)
  const seat = crewFor(db, stop.id).find((item) => item.operator_id === operatorId)
  if (!seat) throw new HttpError(403, 'This stop is not on your list.')
  const machine = db.prepare('SELECT * FROM machines WHERE id = ?').get(machineId)
  const day = db.prepare('SELECT * FROM days WHERE id = ?').get(stop.day_id)
  const ticket = db.prepare('SELECT * FROM tickets WHERE day_id = ? AND site_id = ? AND workflow = ?').get(day.id, stop.site_id, stop.workflow)
  if (!ticket) throw new HttpError(400, 'Clock in before closing the meter.')
  const open = db.prepare(`SELECT * FROM meter_stints WHERE ticket_id = ? AND machine_id = ? AND operator_id = ? AND end_reading IS NULL`).all(ticket.id, machineId, operatorId)
  if (!open.length) throw new HttpError(400, 'There is no open reading on that machine.')
  for (const stint of open) {
    const reading = Number(readings?.[stint.meter])
    if (!Number.isFinite(reading)) throw new HttpError(400, `Enter the ending ${stint.meter === 'hours' ? 'hour' : 'kilometre'} reading.`)
    if (reading < stint.start_reading) throw new HttpError(400, 'That reading is below the starting reading.')
    db.prepare('UPDATE meter_stints SET end_reading = ?, ended_at = ? WHERE id = ?').run(reading, nowIso(), stint.id)
    const column = stint.meter === 'hours' ? 'last_hours' : 'last_km'
    db.prepare(`UPDATE machines SET ${column} = ? WHERE id = ?`).run(reading, machine.id)
  }
  return publicTicket(db, db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket.id))
}

export function breakdown(db, { stopId, operatorId, toMachineId, ending, starting, note }) {
  const stop = mustStop(db, stopId)
  const seat = crewFor(db, stop.id).find((item) => item.operator_id === operatorId)
  if (!seat?.machine_id) throw new HttpError(400, 'Get into a machine before reporting a breakdown.')
  const from = db.prepare('SELECT * FROM machines WHERE id = ?').get(seat.machine_id)
  const to = db.prepare('SELECT * FROM machines WHERE id = ? AND active = 1').get(toMachineId)
  if (!to || to.id === from.id) throw new HttpError(400, 'Pick a different machine.')
  if (to.type !== from.type) throw new HttpError(400, 'Swap to the same kind of machine.')
  const day = db.prepare('SELECT * FROM days WHERE id = ?').get(stop.day_id)
  const window = { start: stop.window_start, end: stop.window_end, release: null }
  const others = stopsFor(db, day.id).filter((item) => item.id !== stop.id)
  const blocked = to.type === 'sander' ? null : others.find((item) => seatBlocked(item, window, (candidate) => crewFor(db, candidate.id).some((crewSeat) => crewSeat.machine_id === to.id)))
  if (blocked) throw new HttpError(400, `${to.code} is already on ${siteName(db, blocked.site_id)} in that window.`)
  db.exec('BEGIN')
  try {
    const ticket = db.prepare('SELECT * FROM tickets WHERE day_id = ? AND site_id = ? AND workflow = ?').get(day.id, stop.site_id, stop.workflow)
    if (ticket) {
      const open = db.prepare(`SELECT * FROM meter_stints WHERE ticket_id = ? AND machine_id = ? AND end_reading IS NULL`).all(ticket.id, from.id)
      for (const stint of open) {
        const reading = Number(ending?.[stint.meter])
        if (!Number.isFinite(reading)) throw new HttpError(400, `Enter the ending ${stint.meter === 'hours' ? 'hour' : 'kilometre'} reading for ${from.code}.`)
        if (reading < stint.start_reading) throw new HttpError(400, 'That reading is below the starting reading.')
        db.prepare('UPDATE meter_stints SET end_reading = ?, ended_at = ? WHERE id = ?').run(reading, nowIso(), stint.id)
        db.prepare(`UPDATE machines SET ${stint.meter === 'hours' ? 'last_hours' : 'last_km'} = ? WHERE id = ?`).run(reading, from.id)
      }
    }
    db.prepare('UPDATE crew SET machine_id = ? WHERE id = ?').run(to.id, seat.id)
    const text = `Breakdown — swap loader. ${seat.operator_label} moved from ${from.code} to ${to.code}. ${note || ''}`.trim()
    db.prepare('UPDATE stops SET driver_note = ? WHERE id = ?').run(text.slice(0, 280), stop.id)
    if (ticket) {
      for (const meter of ['hours', 'km']) {
        const flag = meter === 'hours' ? to.track_hours : to.track_km
        if (flag !== 1) continue
        const reading = Number(starting?.[meter])
        const last = meter === 'hours' ? to.last_hours : to.last_km
        if (!Number.isFinite(reading)) throw new HttpError(400, `Enter the starting ${meter === 'hours' ? 'hour' : 'kilometre'} reading for ${to.code}.`)
        if (last != null && reading < last) throw new HttpError(400, `That reading is below the last meter (${last}).`)
        db.prepare(`INSERT INTO meter_stints
          (id, ticket_id, machine_id, operator_id, meter, start_reading, started_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), ticket.id, to.id, operatorId, meter, reading, nowIso())
      }
    }
    const body = `${text} Simulated notice for the dispatcher. Not sent to a phone.`
    for (const dispatcher of db.prepare(`SELECT * FROM users WHERE role = 'dispatcher' AND active = 1`).all()) {
      db.prepare(`INSERT INTO messages
        (id, day_id, user_id, operator_id, channel, kind, body, simulated, delivered, created_at)
        VALUES (?, ?, ?, ?, 'push', 'switch', ?, 1, 0, ?)`).run(randomUUID(), day.id, dispatcher.id, operatorId, body, nowIso())
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return publicStop(db, mustStop(db, stopId))
}

export function setWeather(db, date, note) {
  const day = ensureDay(db, date)
  db.prepare('UPDATE days SET weather_note = ? WHERE id = ?').run(String(note || '').slice(0, 280), day.id)
  return getPlan(db, date).day
}

export function setSand(db, { stopId, operatorId, yards }) {
  const stop = mustStop(db, stopId)
  if (!crewFor(db, stop.id).some((seat) => seat.operator_id === operatorId)) throw new HttpError(403, 'This stop is not on your list.')
  if (!SAND_STEPS_YARDS.includes(Number(yards))) throw new HttpError(400, 'Pick a sand volume from the list.')
  const day = db.prepare('SELECT * FROM days WHERE id = ?').get(stop.day_id)
  let ticket = db.prepare('SELECT * FROM tickets WHERE day_id = ? AND site_id = ? AND workflow = ?').get(day.id, stop.site_id, stop.workflow)
  if (!ticket) {
    clock(db, { stopId, operatorId, edge: 'in' })
    ticket = db.prepare('SELECT * FROM tickets WHERE day_id = ? AND site_id = ? AND workflow = ?').get(day.id, stop.site_id, stop.workflow)
  }
  db.prepare('UPDATE tickets SET sand_yards = ? WHERE id = ?').run(Number(yards), ticket.id)
  return publicTicket(db, db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket.id))
}

export function addLoad(db, { stopId, operatorId }) {
  const stop = mustStop(db, stopId)
  if (stop.workflow !== 'hauling') throw new HttpError(400, 'Loads are counted on hauling stops.')
  if (!crewFor(db, stop.id).some((seat) => seat.operator_id === operatorId)) throw new HttpError(403, 'This stop is not on your list.')
  const day = db.prepare('SELECT * FROM days WHERE id = ?').get(stop.day_id)
  let ticket = db.prepare('SELECT * FROM tickets WHERE day_id = ? AND site_id = ? AND workflow = ?').get(day.id, stop.site_id, stop.workflow)
  if (!ticket) {
    clock(db, { stopId, operatorId, edge: 'in' })
    ticket = db.prepare('SELECT * FROM tickets WHERE day_id = ? AND site_id = ? AND workflow = ?').get(day.id, stop.site_id, stop.workflow)
  }
  db.prepare('UPDATE tickets SET loads = loads + 1 WHERE id = ?').run(ticket.id)
  db.prepare('UPDATE stops SET loads = COALESCE(loads, 0) + 1 WHERE id = ?').run(stop.id)
  return publicTicket(db, db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket.id))
}

export function setPreference(db, operatorId, value) {
  const stored = value === true || value === 1 ? 1 : value === false || value === 0 ? 0 : null
  db.prepare('UPDATE operators SET notify_job_edges = ? WHERE id = ?').run(stored, operatorId)
  return db.prepare('SELECT id, label, notify_job_edges FROM operators WHERE id = ?').get(operatorId)
}

export function listTickets(db, date) {
  const day = db.prepare('SELECT * FROM days WHERE work_date = ?').get(date)
  if (!day) return []
  return db.prepare('SELECT * FROM tickets WHERE day_id = ? ORDER BY clock_in').all(day.id).map((ticket) => publicTicket(db, ticket))
}

export function publicTicket(db, ticket) {
  const settings = getSettings(db)
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(ticket.site_id)
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(site.client_id)
  const day = db.prepare('SELECT * FROM days WHERE id = ?').get(ticket.day_id)
  const stints = db.prepare(`SELECT meter_stints.*, machines.code FROM meter_stints
    JOIN machines ON machines.id = meter_stints.machine_id WHERE ticket_id = ?`).all(ticket.id)
  const crew = db.prepare(`SELECT operators.label AS operator_label, machines.code AS machine_code
    FROM crew
    JOIN operators ON operators.id = crew.operator_id
    LEFT JOIN machines ON machines.id = crew.machine_id
    WHERE crew.stop_id = ?
    ORDER BY crew.sort_order`).all(ticket.stop_id)
  const hours = hoursBetween(ticket.clock_in, ticket.clock_out) + hoursBetween(ticket.clock_in_2, ticket.clock_out_2)
  const flatPush = ticket.workflow === 'pushing' && client.billing === 'flat'
  return {
    id: ticket.id,
    occurrenceId: `${day.work_date}:${site.id}:${ticket.workflow}`,
    billableOccurrences: flatPush ? 1 : 0,
    billingNote: flatPush
      ? 'One billable occurrence for this site today, however many loaders worked it.'
      : client.billing === 'hourly'
        ? 'Hourly client. Hours are the record. This is not a flat-rate occurrence.'
        : 'This visit is recorded. It is not a second flat-rate occurrence.',
    date: day.work_date,
    clientName: client.name,
    siteName: site.name,
    workflow: ticket.workflow,
    clockIn: ticket.clock_in,
    clockOut: ticket.clock_out,
    clockIn2: ticket.clock_in_2,
    clockOut2: ticket.clock_out_2,
    hours,
    operators: crew.map((seat) => seat.operator_label).filter(Boolean),
    machines: crew.map((seat) => seat.machine_code).filter(Boolean),
    sand: ticket.sand_yards == null ? '' : formatMeasure('sand', ticket.sand_yards, settings.units),
    sandYards: ticket.sand_yards,
    loads: ticket.loads || 0,
    weather: day.weather_note || '',
    notes: ticket.notes || '',
    workDone: ticket.work_done || '',
    meters: stints.map((stint) => ({
      machine: stint.code,
      meter: stint.meter,
      start: stint.start_reading,
      end: stint.end_reading,
      usage: stint.end_reading == null ? null : Math.round((stint.end_reading - stint.start_reading) * 100) / 100,
    })),
  }
}

export function dispatcherCsv(db, date) {
  const tickets = date ? listTickets(db, date) : allTickets(db)
  const header = ['occurrence_id', 'billable_occurrences', 'client', 'site', 'date', 'workflow', 'clock_in', 'clock_out', 'clock_in_2', 'clock_out_2', 'hours', 'operators', 'machines', 'meter_readings', 'usage', 'sand_volume', 'loads', 'weather', 'notes']
  const rows = tickets.map((ticket) => [
    ticket.occurrenceId,
    ticket.billableOccurrences,
    ticket.clientName,
    ticket.siteName,
    ticket.date,
    ticket.workflow,
    ticket.clockIn || '',
    ticket.clockOut || '',
    ticket.clockIn2 || '',
    ticket.clockOut2 || '',
    ticket.hours,
    ticket.operators.join('; '),
    ticket.machines.join('; '),
    ticket.meters.map((meter) => `${meter.machine} ${meter.meter} ${meter.start} to ${meter.end ?? ''}`).join('; '),
    ticket.meters.map((meter) => `${meter.machine} ${meter.meter} ${meter.usage ?? ''}`).join('; '),
    ticket.sand,
    ticket.loads,
    ticket.weather,
    ticket.notes,
  ])
  return toCsv(header, rows)
}

export function clientCsv(db, clientId) {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId)
  if (!client) throw new HttpError(404, 'That client was not found.')
  const tickets = allTickets(db).filter((ticket) => ticket.clientName === client.name)
  const header = ['site', 'date', 'clock_in', 'clock_out', 'clock_in_2', 'clock_out_2', 'hours', 'sand_volume', 'loads']
  const rows = tickets.map((ticket) => [
    ticket.siteName, ticket.date, ticket.clockIn || '', ticket.clockOut || '', ticket.clockIn2 || '', ticket.clockOut2 || '', ticket.hours, ticket.sand, ticket.loads,
  ])
  return toCsv(header, rows)
}

function allTickets(db) {
  return db.prepare('SELECT * FROM tickets ORDER BY clock_in').all().map((ticket) => publicTicket(db, ticket))
}

function toCsv(header, rows) {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n'
}

function csvCell(value) {
  const text = value == null ? '' : String(value)
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

export function mustStop(db, id) {
  const stop = db.prepare('SELECT * FROM stops WHERE id = ?').get(id)
  if (!stop) throw new HttpError(404, 'That stop is not on the plan.')
  return stop
}

export function operatorPlan(db, operatorId, date) {
  const plan = getPlan(db, date)
  const mine = plan.stops.filter((stop) => stop.crew.some((seat) => seat.operatorId === operatorId))
  const operator = db.prepare('SELECT * FROM operators WHERE id = ?').get(operatorId)
  return {
    ...plan,
    stops: mine,
    operator: {
      id: operator.id,
      label: operator.label,
      notifyJobEdges: operator.notify_job_edges == null ? null : operator.notify_job_edges === 1,
      phone: operator.phone,
    },
  }
}

export function catalog(db) {
  const settings = getSettings(db)
  return {
    settings: publicSettings(settings),
    workflows,
    operators: db.prepare('SELECT * FROM operators WHERE active = 1 ORDER BY label').all().map((row) => publicOperator(row)),
    machines: db.prepare('SELECT * FROM machines WHERE active = 1 ORDER BY code').all().map((row) => publicMachine(row, settings)),
    clients: db.prepare('SELECT * FROM clients WHERE active = 1 ORDER BY name').all().map(publicClient),
    sites: db.prepare('SELECT * FROM sites WHERE active = 1 ORDER BY name').all().map((row) => publicSite(db, row, settings)),
    sandSteps: SAND_STEPS_YARDS.map((yards) => ({ yards, label: formatMeasure('sand', yards, settings.units) })),
  }
}

export function publicOperator(row) {
  return {
    id: row.id,
    label: row.label,
    experience: row.experience,
    usualMachineId: row.usual_machine_id || '',
    phone: row.phone || '',
    email: row.email || '',
    notifyJobEdges: row.notify_job_edges == null ? null : row.notify_job_edges === 1,
  }
}

export function publicMachine(row, settings) {
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    implement: row.implement || '',
    trackHours: row.track_hours == null ? null : row.track_hours === 1,
    trackKm: row.track_km == null ? null : row.track_km === 1,
    lastHours: row.last_hours,
    lastKm: row.last_km,
  }
}

export function publicClient(row) {
  return {
    id: row.id,
    name: row.name,
    contactRole: row.contact_role || '',
    phone: row.phone || '',
    email: row.email || '',
    billing: row.billing,
  }
}

export function publicSite(db, row, settings = getSettings(db)) {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(row.client_id)
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: client?.name || '',
    name: row.name,
    address: row.address || '',
    pushTag: row.push_tag,
    sandTag: row.sand_tag,
    haulTag: row.haul_tag,
    windowStart: formatTime(row.window_start),
    windowEnd: formatTime(row.window_end),
    bylawEarliest: formatTime(row.bylaw_earliest),
    hazards: row.hazards || '',
    area: row.area_sqft == null ? '' : toDisplay('area', row.area_sqft, settings.units),
    areaLabel: formatMeasure('area', row.area_sqft, settings.units),
    notes: row.notes || '',
    defaultSand: row.default_sand_yards == null ? '' : toDisplay('sand', row.default_sand_yards, settings.units),
    defaultSandLabel: formatMeasure('sand', row.default_sand_yards, settings.units),
    tags: tagsFor(row),
  }
}

export function saveOperator(db, input, id) {
  if (!input.label?.trim()) throw new HttpError(400, 'Enter the operator label.')
  if (!['experienced', 'inexperienced'].includes(input.experience)) throw new HttpError(400, 'Pick experienced or inexperienced.')
  const notify = input.notifyJobEdges === true ? 1 : input.notifyJobEdges === false ? 0 : null
  if (id) {
    db.prepare(`UPDATE operators SET label = ?, experience = ?, usual_machine_id = ?, phone = ?, email = ?, notify_job_edges = ? WHERE id = ?`).run(
      input.label.trim(), input.experience, input.usualMachineId || null, input.phone || '', input.email || '', notify, id,
    )
    if (input.email) db.prepare('UPDATE users SET email = ? WHERE operator_id = ?').run(input.email.trim(), id)
    return publicOperator(db.prepare('SELECT * FROM operators WHERE id = ?').get(id))
  }
  const operatorId = randomUUID()
  db.prepare(`INSERT INTO operators (id, label, experience, usual_machine_id, phone, email, notify_job_edges, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)`).run(operatorId, input.label.trim(), input.experience, input.usualMachineId || null, input.phone || '', input.email || '', notify)
  const password = input.password || `crew-${operatorId.slice(0, 8)}`
  db.prepare('INSERT INTO users (id, email, password_hash, role, operator_id, active) VALUES (?, ?, ?, ?, ?, 1)').run(
    randomUUID(), (input.email || `${operatorId}@kakwa.example`).trim(), hashPassword(password), 'operator', operatorId,
  )
  return { ...publicOperator(db.prepare('SELECT * FROM operators WHERE id = ?').get(operatorId)), initialPassword: password }
}

export function archiveOperator(db, id) {
  db.prepare('UPDATE operators SET active = 0 WHERE id = ?').run(id)
  db.prepare('UPDATE users SET active = 0 WHERE operator_id = ?').run(id)
}

export function saveMachine(db, input, id) {
  if (!input.code?.trim()) throw new HttpError(400, 'Enter the machine id.')
  if (!['loader', 'sander', 'haul_truck'].includes(input.type)) throw new HttpError(400, 'Pick a machine type.')
  const hours = tri(input.trackHours)
  const km = tri(input.trackKm)
  const lastHours = input.lastHours === '' || input.lastHours == null ? null : Number(input.lastHours)
  const lastKm = input.lastKm === '' || input.lastKm == null ? null : Number(input.lastKm)
  if (id) {
    db.prepare(`UPDATE machines SET code = ?, type = ?, implement = ?, track_hours = ?, track_km = ?, last_hours = ?, last_km = ? WHERE id = ?`).run(
      input.code.trim(), input.type, input.implement || '', hours, km, lastHours, lastKm, id,
    )
    return publicMachine(db.prepare('SELECT * FROM machines WHERE id = ?').get(id), getSettings(db))
  }
  const machineId = randomUUID()
  db.prepare(`INSERT INTO machines (id, code, type, implement, track_hours, track_km, last_hours, last_km, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(machineId, input.code.trim(), input.type, input.implement || '', hours, km, lastHours, lastKm)
  return publicMachine(db.prepare('SELECT * FROM machines WHERE id = ?').get(machineId), getSettings(db))
}

function tri(value) {
  if (value === true || value === 1) return 1
  if (value === false || value === 0) return 0
  return null
}

export function archiveMachine(db, id) {
  db.prepare('UPDATE machines SET active = 0 WHERE id = ?').run(id)
}

export function saveClient(db, input, id) {
  if (!input.name?.trim()) throw new HttpError(400, 'Enter the client name.')
  if (!['flat', 'hourly'].includes(input.billing)) throw new HttpError(400, 'Pick flat rate or hourly.')
  if (id) {
    db.prepare('UPDATE clients SET name = ?, contact_role = ?, phone = ?, email = ?, billing = ? WHERE id = ?').run(
      input.name.trim(), input.contactRole || 'Accounts desk', input.phone || '', input.email || '', input.billing, id,
    )
    return publicClient(db.prepare('SELECT * FROM clients WHERE id = ?').get(id))
  }
  const clientId = randomUUID()
  db.prepare('INSERT INTO clients (id, name, contact_role, phone, email, billing, active) VALUES (?, ?, ?, ?, ?, ?, 1)').run(
    clientId, input.name.trim(), input.contactRole || 'Accounts desk', input.phone || '', input.email || '', input.billing,
  )
  return publicClient(db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId))
}

export function archiveClient(db, id) {
  db.prepare('UPDATE clients SET active = 0 WHERE id = ?').run(id)
  db.prepare('UPDATE sites SET active = 0 WHERE client_id = ?').run(id)
}

export function saveSite(db, input, id) {
  const settings = getSettings(db)
  if (!input.name?.trim()) throw new HttpError(400, 'Enter the site name.')
  if (!input.clientId) throw new HttpError(400, 'Pick a client.')
  for (const key of ['pushTag', 'sandTag', 'haulTag']) {
    if (!['automatic', 'on_call', 'off'].includes(input[key])) throw new HttpError(400, 'Set each service to automatic, on call, or not offered.')
  }
  const area = input.area === '' || input.area == null ? null : fromDisplay('area', Number(input.area), settings.units)
  const sand = input.defaultSand === '' || input.defaultSand == null ? null : fromDisplay('sand', Number(input.defaultSand), settings.units)
  const values = [
    input.clientId, input.name.trim(), input.address || '', input.pushTag, input.sandTag, input.haulTag,
    parseTime(input.windowStart), parseTime(input.windowEnd), parseTime(input.bylawEarliest),
    input.hazards || '', area, input.notes || '', sand,
  ]
  if (id) {
    db.prepare(`UPDATE sites SET client_id = ?, name = ?, address = ?, push_tag = ?, sand_tag = ?, haul_tag = ?, window_start = ?, window_end = ?, bylaw_earliest = ?, hazards = ?, area_sqft = ?, notes = ?, default_sand_yards = ? WHERE id = ?`).run(...values, id)
    return publicSite(db, db.prepare('SELECT * FROM sites WHERE id = ?').get(id))
  }
  const siteId = randomUUID()
  db.prepare(`INSERT INTO sites
    (id, client_id, name, address, push_tag, sand_tag, haul_tag, window_start, window_end, bylaw_earliest, hazards, area_sqft, notes, default_sand_yards, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(siteId, ...values)
  return publicSite(db, db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId))
}

export function archiveSite(db, id) {
  db.prepare('UPDATE sites SET active = 0 WHERE id = ?').run(id)
}

export { addDays }
