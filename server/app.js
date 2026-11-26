import { createReadStream, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import {
  clearCookie,
  loginOptions,
  loginPassword,
  loginVerify,
  logout,
  registrationOptions,
  registrationVerify,
  requestRecovery,
  sessionCookie,
  sessionUser,
  setPassword,
  verifyRecovery,
} from './auth.js'
import { HttpError } from './errors.js'
import {
  addLoad,
  archiveClient,
  archiveMachine,
  archiveOperator,
  archiveSite,
  breakdown,
  catalog,
  choices,
  clientCsv,
  clock,
  copyPrevious,
  createStop,
  dispatcherCsv,
  endMeter,
  getPlan,
  listMessages,
  listTickets,
  listWorkflows,
  moveStop,
  mustStop,
  operatorPlan,
  publicTicket,
  pullTrigger,
  removeStop,
  runLong,
  saveClient,
  saveMachine,
  saveOperator,
  saveSettings,
  saveSite,
  setNote,
  setPreference,
  setSand,
  setWeather,
  startMeter,
  switchSite,
} from './plan.js'
import { zonedDate } from './time.js'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
}

export function startServer(db, port = 0) {
  const server = createServer((req, res) => {
    handle(db, req, res).catch((error) => sendError(res, error))
  })
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

async function handle(db, req, res) {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res)
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-kakwa'] !== '1') {
    throw new HttpError(403, 'Missing app header.')
  }
  const token = readCookie(req, 'kakwa_session')
  const user = sessionUser(db, token)
  const body = req.method === 'GET' || req.method === 'HEAD' ? {} : await readBody(req)
  const result = await route(db, req.method, url, body, user, token)
  if (result?.cookie) res.setHeader('set-cookie', result.cookie)
  if (result?.csv) {
    res.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${result.filename}"`,
    })
    res.end(result.csv)
    return
  }
  send(res, result?.status || 200, result?.body ?? { ok: true })
}

async function route(db, method, url, body, user, token) {
  const path = url.pathname
  if (method === 'POST' && path === '/api/auth/login') {
    const session = loginPassword(db, body.email, body.password)
    return { body: { user: session.user }, cookie: sessionCookie(session.token) }
  }
  if (method === 'POST' && path === '/api/auth/logout') {
    logout(db, token)
    return { cookie: clearCookie() }
  }
  if (method === 'POST' && path === '/api/auth/recovery/request') return { body: requestRecovery(db, body.email) }
  if (method === 'POST' && path === '/api/auth/recovery/verify') {
    const session = verifyRecovery(db, body.email, body.code)
    return { body: { user: session.user }, cookie: sessionCookie(session.token) }
  }
  if (method === 'POST' && path === '/api/passkey/login/options') return { body: await loginOptions(db) }
  if (method === 'POST' && path === '/api/passkey/login/verify') {
    const session = await loginVerify(db, body)
    return { body: { user: session.user }, cookie: sessionCookie(session.token) }
  }
  if (!user) throw new HttpError(401, 'Sign in first.')
  if (method === 'GET' && path === '/api/me') return { body: { user, today: zonedDate() } }
  if (method === 'POST' && path === '/api/me/password') {
    setPassword(db, user.id, body.password)
    return { body: { ok: true } }
  }
  if (method === 'POST' && path === '/api/passkey/register/options') return { body: await registrationOptions(db, user) }
  if (method === 'POST' && path === '/api/passkey/register/verify') return { body: await registrationVerify(db, user, body) }
  if (method === 'GET' && path === '/api/workflows') return { body: { workflows: listWorkflows() } }
  if (method === 'GET' && path === '/api/catalog') return { body: visibleCatalog(catalog(db), user) }
  if (method === 'GET' && path === '/api/plan') {
    if (user.role !== 'dispatcher') throw new HttpError(403, 'Dispatcher sign-in required.')
    return { body: getPlan(db, url.searchParams.get('date') || zonedDate()) }
  }
  if (method === 'GET' && path === '/api/choices') {
    return { body: choices(db, {
      date: url.searchParams.get('date'),
      workflow: url.searchParams.get('workflow'),
      windowStart: url.searchParams.get('start'),
      windowEnd: url.searchParams.get('end'),
      releaseAt: url.searchParams.get('release'),
    }) }
  }
  if (method === 'GET' && path === '/api/messages') {
    const messages = listMessages(db, url.searchParams.get('date') || zonedDate())
    const visible = user.role === 'dispatcher' ? messages : messages.filter((message) => message.operatorId === user.operatorId)
    return { body: { messages: visible } }
  }
  if (method === 'GET' && path === '/api/tickets') {
    if (user.role !== 'dispatcher') throw new HttpError(403, 'Dispatcher sign-in required.')
    return { body: { tickets: listTickets(db, url.searchParams.get('date') || zonedDate()) } }
  }
  if (method === 'GET' && path === '/api/operator/ticket') {
    const stop = mustStop(db, url.searchParams.get('stopId'))
    const operatorId = actingOperator(user, url.searchParams.get('operatorId'))
    const seat = db.prepare('SELECT 1 AS ok FROM crew WHERE stop_id = ? AND operator_id = ?').get(stop.id, operatorId)
    if (!seat) throw new HttpError(403, 'This stop is not on your list.')
    const ticket = db.prepare('SELECT * FROM tickets WHERE day_id = ? AND site_id = ? AND workflow = ?').get(stop.day_id, stop.site_id, stop.workflow)
    return { body: { ticket: ticket ? publicTicket(db, ticket) : null } }
  }
  if (method === 'GET' && path === '/api/operator') {
    const operatorId = actingOperator(user, url.searchParams.get('operatorId'))
    return { body: operatorPlan(db, operatorId, url.searchParams.get('date') || zonedDate()) }
  }

  if (user.role !== 'dispatcher' && isDispatcherPath(method, path)) throw new HttpError(403, 'Dispatcher sign-in required.')

  if (method === 'POST' && path === '/api/plan/copy') return { body: copyPrevious(db, body.date) }
  if (method === 'POST' && path === '/api/stops') return { body: createStop(db, body) }
  const stopMove = path.match(/^\/api\/stops\/([^/]+)\/move$/)
  if (method === 'POST' && stopMove) return { body: moveStop(db, stopMove[1], Number(body.direction)) }
  const stopNote = path.match(/^\/api\/stops\/([^/]+)\/note$/)
  if (method === 'POST' && stopNote) return { body: setNote(db, stopNote[1], body.note) }
  const stopLong = path.match(/^\/api\/stops\/([^/]+)\/long$/)
  if (method === 'POST' && stopLong) return { body: { stops: runLong(db, stopLong[1], body.minutes) } }
  const stopSwitch = path.match(/^\/api\/stops\/([^/]+)\/switch$/)
  if (method === 'POST' && stopSwitch) return { body: switchSite(db, { stopId: stopSwitch[1], ...body }) }
  const stopId = path.match(/^\/api\/stops\/([^/]+)$/)
  if (method === 'DELETE' && stopId) {
    removeStop(db, stopId[1])
    return { body: { ok: true } }
  }
  if (method === 'POST' && path === '/api/trigger') return { body: pullTrigger(db, body.date, body.snow) }
  if (method === 'PATCH' && path === '/api/settings') return { body: saveSettings(db, body) }
  if (method === 'POST' && path === '/api/operators') return { body: saveOperator(db, body) }
  const operator = path.match(/^\/api\/operators\/([^/]+)$/)
  if (method === 'PATCH' && operator) return { body: saveOperator(db, body, operator[1]) }
  if (method === 'DELETE' && operator) {
    archiveOperator(db, operator[1])
    return { body: { ok: true } }
  }
  if (method === 'POST' && path === '/api/machines') return { body: saveMachine(db, body) }
  const machine = path.match(/^\/api\/machines\/([^/]+)$/)
  if (method === 'PATCH' && machine) return { body: saveMachine(db, body, machine[1]) }
  if (method === 'DELETE' && machine) {
    archiveMachine(db, machine[1])
    return { body: { ok: true } }
  }
  if (method === 'POST' && path === '/api/clients') return { body: saveClient(db, body) }
  const clientExport = path.match(/^\/api\/clients\/([^/]+)\/export$/)
  if (method === 'GET' && clientExport) return { csv: clientCsv(db, clientExport[1]), filename: 'client-export.csv' }
  const client = path.match(/^\/api\/clients\/([^/]+)$/)
  if (method === 'PATCH' && client) return { body: saveClient(db, body, client[1]) }
  if (method === 'DELETE' && client) {
    archiveClient(db, client[1])
    return { body: { ok: true } }
  }
  if (method === 'POST' && path === '/api/sites') return { body: saveSite(db, body) }
  const site = path.match(/^\/api\/sites\/([^/]+)$/)
  if (method === 'PATCH' && site) return { body: saveSite(db, body, site[1]) }
  if (method === 'DELETE' && site) {
    archiveSite(db, site[1])
    return { body: { ok: true } }
  }
  if (method === 'GET' && path === '/api/export/dispatcher') {
    return { csv: dispatcherCsv(db, url.searchParams.get('date') || ''), filename: 'dispatcher-export.csv' }
  }
  if (method === 'POST' && path === '/api/clock') {
    const operatorId = actingOperator(user, body.operatorId)
    return { body: clock(db, { ...body, operatorId }) }
  }
  if (method === 'POST' && path === '/api/meters/start') {
    return { body: startMeter(db, { ...body, operatorId: actingOperator(user, body.operatorId) }) }
  }
  if (method === 'POST' && path === '/api/meters/end') {
    return { body: endMeter(db, { ...body, operatorId: actingOperator(user, body.operatorId) }) }
  }
  if (method === 'POST' && path === '/api/breakdown') {
    return { body: breakdown(db, { ...body, operatorId: actingOperator(user, body.operatorId) }) }
  }
  if (method === 'POST' && path === '/api/weather') return { body: setWeather(db, body.date, body.note) }
  if (method === 'POST' && path === '/api/sand') {
    return { body: setSand(db, { ...body, operatorId: actingOperator(user, body.operatorId) }) }
  }
  if (method === 'POST' && path === '/api/loads') {
    return { body: addLoad(db, { ...body, operatorId: actingOperator(user, body.operatorId) }) }
  }
  if (method === 'POST' && path === '/api/preference') {
    const operatorId = actingOperator(user, body.operatorId)
    return { body: setPreference(db, operatorId, body.notifyJobEdges) }
  }
  if (method === 'POST' && path === '/api/push/subscribe') {
    const id = body.endpoint
    if (!id) throw new HttpError(400, 'Missing push subscription.')
    db.prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, keys_json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET keys_json = excluded.keys_json').run(
      id, user.id, body.endpoint, JSON.stringify(body.keys || {}),
    )
    return { body: { saved: true, delivered: false, notice: 'The browser subscription is saved. Pushes are only logged in this build. Nothing is delivered to a phone.' } }
  }
  throw new HttpError(404, 'Not found.')
}

function visibleCatalog(data, user) {
  if (user.role === 'dispatcher') return data
  return {
    ...data,
    clients: data.clients.map((item) => ({ id: item.id, name: item.name, billing: item.billing })),
    operators: data.operators.map((item) => ({
      id: item.id,
      label: item.label,
      experience: item.experience,
      usualMachineId: item.usualMachineId,
      notifyJobEdges: item.notifyJobEdges,
    })),
  }
}

function isDispatcherPath(method, path) {
  if (path.startsWith('/api/stops') && method !== 'POST') return true
  if (path.endsWith('/note')) return false
  return [
    '/api/plan/copy', '/api/stops', '/api/trigger', '/api/settings', '/api/operators', '/api/machines', '/api/clients', '/api/sites', '/api/export/dispatcher',
  ].some((prefix) => path === prefix || path.startsWith(`${prefix}/`)) || path.includes('/move') || path.includes('/long') || path.includes('/switch') || path.includes('/export')
}

function actingOperator(user, requested) {
  if (user.role === 'operator') {
    if (requested && requested !== user.operatorId) throw new HttpError(403, 'Operators can only update their own work.')
    return user.operatorId
  }
  if (!requested) throw new HttpError(400, 'Pick which operator you are working as.')
  return requested
}

function readCookie(req, name) {
  const header = req.headers.cookie || ''
  const match = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : ''
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString())
  } catch {
    throw new HttpError(400, 'The request was not valid.')
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function sendError(res, error) {
  const status = error.status || 500
  if (status === 500) console.error(error)
  send(res, status, { error: status === 500 ? 'Something went wrong.' : error.message })
}

function serveStatic(pathname, res) {
  const root = join(process.cwd(), 'dist')
  const requested = pathname === '/' ? '/index.html' : pathname
  const file = normalize(join(root, requested))
  if (!file.startsWith(root) || !existsSync(file)) {
    const fallback = join(root, 'index.html')
    if (!existsSync(fallback)) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    createReadStream(fallback).pipe(res)
    return
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' })
  createReadStream(file).pipe(res)
}
