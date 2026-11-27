import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { startServer } from '../server/app.js'
import { openDatabase } from '../server/db.js'
import { addDays, zonedDate } from '../server/time.js'

const db = openDatabase()
const server = await startServer(db, 0)
const base = `http://127.0.0.1:${server.address().port}`
const today = zonedDate()

after(() => new Promise((resolve) => {
  server.close(() => {
    db.close()
    resolve()
  })
}))

function client() {
  let cookie = ''
  return async function api(path, { method = 'GET', body } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-kakwa': '1',
        ...(cookie ? { cookie } : {}),
      },
      body: body == null ? undefined : JSON.stringify(body),
    })
    const next = response.headers.getSetCookie?.() || []
    for (const item of next) {
      const pair = item.split(';')[0]
      if (pair.startsWith('kakwa_session=')) cookie = pair
    }
    const type = response.headers.get('content-type') || ''
    const payload = type.includes('json') ? await response.json() : await response.text()
    return { status: response.status, payload }
  }
}

test('dispatcher and backup can sign in; an operator cannot change setup', async () => {
  const dispatcher = client()
  const login = await dispatcher('/api/auth/login', { method: 'POST', body: { email: 'dispatcher@kakwa.example', password: 'spruce-day-shift' } })
  assert.equal(login.payload.user.role, 'dispatcher')
  const backup = client()
  const second = await backup('/api/auth/login', { method: 'POST', body: { email: 'backup@kakwa.example', password: 'spruce-backup-day' } })
  assert.equal(second.payload.user.role, 'dispatcher')
  const operator = client()
  await operator('/api/auth/login', { method: 'POST', body: { email: 'operator1@kakwa.example', password: 'operator-1-day' } })
  const denied = await operator('/api/settings', { method: 'PATCH', body: { units: 'metric' } })
  assert.equal(denied.status, 403)
})

test('planning enforces bylaw, release, pairing warning, and one occurrence', async () => {
  const api = client()
  await api('/api/auth/login', { method: 'POST', body: { email: 'dispatcher@kakwa.example', password: 'spruce-day-shift' } })
  const date = addDays(today, 2)
  const early = await api('/api/stops', { method: 'POST', body: {
    date, workflow: 'pushing', siteId: 'site-riverstone', windowStart: '05:00', windowEnd: '07:00', operatorIds: ['op-1'],
  } })
  assert.equal(early.status, 400)
  assert.match(early.payload.error, /6:30 AM/)
  const first = await api('/api/stops', { method: 'POST', body: {
    date, workflow: 'pushing', siteId: 'site-northgate', windowStart: '05:00', windowEnd: '07:00', releaseAt: '06:30', operatorIds: ['op-1'],
  } })
  assert.equal(first.status, 200)
  assert.equal(first.payload.stop.crew[0].machineCode, '')
  const handoff = await api('/api/stops', { method: 'POST', body: {
    date, workflow: 'pushing', siteId: 'site-pinnacle', windowStart: '06:30', windowEnd: '08:30', operatorIds: ['op-1'],
  } })
  assert.equal(handoff.status, 200, handoff.payload.error)
  const blocked = await api('/api/stops', { method: 'POST', body: {
    date, workflow: 'pushing', siteId: 'site-horizon', windowStart: '06:00', windowEnd: '08:00', operatorIds: ['op-1'],
  } })
  assert.equal(blocked.status, 400)
  assert.match(blocked.payload.error, /Operator 1/)
  const pair = await api('/api/stops', { method: 'POST', body: {
    date, workflow: 'pushing', siteId: 'site-horizon', windowStart: '09:00', windowEnd: '11:00', operatorIds: ['op-3', 'op-5'],
  } })
  assert.equal(pair.status, 200)
  assert.match(pair.payload.warning, /no experienced lead/)
  await api('/api/settings', { method: 'PATCH', body: { machineAssignment: true } })
  const loaders = await api('/api/stops', { method: 'POST', body: {
    date: addDays(today, 3), workflow: 'pushing', siteId: 'site-cedar', windowStart: '08:00', windowEnd: '10:00',
    operatorIds: ['op-1', 'op-2'], machines: { 'op-1': 'ld-12', 'op-2': 'ld-07' },
  } })
  assert.equal(loaders.status, 200, loaders.payload.error)
  const double = await api('/api/stops', { method: 'POST', body: {
    date: addDays(today, 3), workflow: 'pushing', siteId: 'site-horizon', windowStart: '09:00', windowEnd: '11:00',
    operatorIds: ['op-3'], machines: { 'op-3': 'ld-12' },
  } })
  assert.equal(double.status, 400)
  assert.match(double.payload.error, /LD-12/)
  await api('/api/settings', { method: 'PATCH', body: { machineAssignment: false } })
})

test('a sander can cover two sites in the same window', async () => {
  const api = client()
  await api('/api/auth/login', { method: 'POST', body: { email: 'dispatcher@kakwa.example', password: 'spruce-day-shift' } })
  const date = addDays(today, 4)
  await api('/api/settings', { method: 'PATCH', body: { machineAssignment: true } })
  const first = await api('/api/stops', { method: 'POST', body: {
    date, workflow: 'sanding', siteId: 'site-northgate', windowStart: '05:15', windowEnd: '06:00',
    operatorIds: ['op-4'], machines: { 'op-4': 'st-3' },
  } })
  const second = await api('/api/stops', { method: 'POST', body: {
    date, workflow: 'sanding', siteId: 'site-pinnacle', windowStart: '05:15', windowEnd: '06:00',
    operatorIds: ['op-4'], machines: { 'op-4': 'st-3' },
  } })
  assert.equal(first.status, 200, first.payload.error)
  assert.equal(second.status, 200, second.payload.error)
  await api('/api/settings', { method: 'PATCH', body: { machineAssignment: false } })
})

test('reorder refuses a bylaw break, and the trigger logs undelivered messages', async () => {
  const api = client()
  await api('/api/auth/login', { method: 'POST', body: { email: 'dispatcher@kakwa.example', password: 'spruce-day-shift' } })
  const date = today
  const copied = await api('/api/plan/copy', { method: 'POST', body: { date } })
  assert.equal(copied.status, 200, copied.payload.error)
  const river = copied.payload.stops.find((stop) => stop.siteName === 'Riverstone Apartments' && stop.workflow === 'pushing')
  const moved = await api(`/api/stops/${river.id}/move`, { method: 'POST', body: { direction: -1 } })
  assert.equal(moved.status, 400)
  assert.match(moved.payload.error, /6:30 AM/)
  const low = await api('/api/trigger', { method: 'POST', body: { date, snow: 0.5 } })
  assert.equal(low.payload.result, 'no_go')
  assert.ok(low.payload.messages.every((message) => message.delivered === false && message.simulated === true))
  const go = await api('/api/trigger', { method: 'POST', body: { date, snow: 3 } })
  assert.equal(go.payload.result, 'go')
  assert.ok(go.payload.messages.some((message) => message.body.startsWith('Go. Pushing at') && message.channel === 'sms'))
  const backup = client()
  await backup('/api/auth/login', { method: 'POST', body: { email: 'backup@kakwa.example', password: 'spruce-backup-day' } })
  const again = await backup('/api/trigger', { method: 'POST', body: { date, snow: 3 } })
  assert.equal(again.status, 200)
})

test('meters, tickets, and exports keep one occurrence and hide internal fields from the client sheet', async () => {
  const dispatcher = client()
  await dispatcher('/api/auth/login', { method: 'POST', body: { email: 'dispatcher@kakwa.example', password: 'spruce-day-shift' } })
  const date = addDays(today, 6)
  await dispatcher('/api/settings', { method: 'PATCH', body: { machineAssignment: true } })
  const created = await dispatcher('/api/stops', { method: 'POST', body: {
    date, workflow: 'pushing', siteId: 'site-northgate', windowStart: '05:00', windowEnd: '07:00',
    operatorIds: ['op-1', 'op-2'], machines: { 'op-1': 'ld-12', 'op-2': 'ld-07' },
  } })
  const stopId = created.payload.stop.id
  const operator = client()
  await operator('/api/auth/login', { method: 'POST', body: { email: 'operator1@kakwa.example', password: 'operator-1-day' } })
  const low = await operator('/api/meters/start', { method: 'POST', body: { stopId, machineId: 'ld-12', readings: { hours: 1000 } } })
  assert.equal(low.status, 400)
  assert.match(low.payload.error, /last meter/)
  const started = await operator('/api/meters/start', { method: 'POST', body: { stopId, machineId: 'ld-12', readings: { hours: 1204.6 } } })
  assert.equal(started.status, 200, started.payload.error)
  const earlyEnd = await operator('/api/meters/end', { method: 'POST', body: { stopId, machineId: 'ld-12', readings: { hours: 1200 } } })
  assert.equal(earlyEnd.status, 400)
  const ended = await operator('/api/meters/end', { method: 'POST', body: { stopId, machineId: 'ld-12', readings: { hours: 1210.1 } } })
  assert.equal(ended.status, 200)
  const quiet = await operator('/api/messages?date=' + date)
  assert.equal(quiet.payload.messages.filter((message) => message.kind === 'job_start').length, 0)
  await operator('/api/preference', { method: 'POST', body: { notifyJobEdges: true } })
  await operator('/api/clock', { method: 'POST', body: { stopId, edge: 'out' } })
  const noisy = await operator('/api/messages?date=' + date)
  const edge = noisy.payload.messages.find((message) => message.kind === 'job_end')
  assert.ok(edge)
  assert.equal(edge.delivered, false)
  const sheet = await dispatcher('/api/export/dispatcher?date=' + date)
  const lines = sheet.payload.trim().split('\n')
  assert.equal(lines.length, 2)
  assert.match(lines[0], /billable_occurrences/)
  assert.match(lines[1], /Operator 1; Operator 2/)
  assert.match(lines[1], /,1,/)
  const clientSheet = await dispatcher('/api/clients/client-northgate/export')
  assert.doesNotMatch(clientSheet.payload, /Operator|LD-12|meter/)
  await dispatcher('/api/settings', { method: 'PATCH', body: { machineAssignment: false } })
  await operator('/api/preference', { method: 'POST', body: { notifyJobEdges: null } })
})

test('recovery shows a code and does not claim the email was sent', async () => {
  const api = client()
  const requested = await api('/api/auth/recovery/request', { method: 'POST', body: { email: 'operator2@kakwa.example' } })
  assert.equal(requested.payload.delivered, false)
  assert.match(requested.payload.notice, /not sent/)
  const signed = await api('/api/auth/recovery/verify', { method: 'POST', body: { email: 'operator2@kakwa.example', code: requested.payload.code } })
  assert.equal(signed.payload.user.operatorLabel, 'Operator 2')
})

test('haul meter toggles stay unconfirmed until someone sets them', async () => {
  const api = client()
  await api('/api/auth/login', { method: 'POST', body: { email: 'dispatcher@kakwa.example', password: 'spruce-day-shift' } })
  const catalog = await api('/api/catalog')
  const truck = catalog.payload.machines.find((machine) => machine.id === 'ht-2')
  assert.equal(truck.trackHours, null)
  assert.equal(truck.trackKm, null)
  const saved = await api('/api/machines/ht-5', { method: 'PATCH', body: {
    code: 'HT-5', type: 'haul_truck', implement: 'Haul truck', trackHours: false, trackKm: true, lastKm: 1000,
  } })
  assert.equal(saved.payload.trackHours, false)
  assert.equal(saved.payload.trackKm, true)
})
