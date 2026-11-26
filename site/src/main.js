import './style.css'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'

const state = {
  me: null,
  date: '',
  error: '',
  notice: '',
  draft: null,
  actingAs: '',
  editorKey: '',
  form: {},
  triggerResult: null,
  holdNotice: false,
}

const screenEl = () => document.querySelector('#screen')

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
}

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'x-kakwa': '1' },
    body: body == null ? undefined : JSON.stringify(body),
  })
  const type = response.headers.get('content-type') || ''
  const payload = type.includes('json') ? await response.json() : await response.text()
  return { status: response.status, payload }
}

function go(hash, notice = '') {
  state.notice = notice
  state.holdNotice = Boolean(notice)
  if (location.hash === hash) draw()
  else location.hash = hash
}

function captureForm() {
  const form = document.querySelector('form[data-form]')
  if (!form) return
  for (const [key, value] of new FormData(form)) state.form[key] = value
}

function pathOf() {
  const raw = location.hash.replace(/^#/, '') || '/home'
  const [path, query] = raw.split('?')
  return { path, params: new URLSearchParams(query || '') }
}

function screen({ kicker, title, lede, back, body }) {
  return `${state.error ? `<p class="banner" role="alert">${esc(state.error)}</p>` : ''}
    ${state.notice ? `<p class="ok">${esc(state.notice)}</p>` : ''}
    <section class="screen">
      ${back ? `<button type="button" class="back" data-go="${esc(back)}">Back</button>` : ''}
      <div class="screen-h">${kicker ? `<p class="kicker">${esc(kicker)}</p>` : ''}<h1>${esc(title)}</h1>${lede ? `<p>${esc(lede)}</p>` : ''}</div>
      ${body}
    </section>`
}

function serviceName(id) {
  return { pushing: 'Pushing', sanding: 'Sanding', hauling: 'Hauling' }[id] || id
}

function tags(list = []) {
  return `<span class="tags">${list.map((tag) => `<span class="tag tag-${tag.service}${tag.mode === 'on_call' ? ' tag-on_call' : ''}">${esc(serviceName(tag.service))}${tag.mode === 'on_call' ? ' · on call' : ''}</span>`).join('')}</span>`
}

async function ensureCatalog() {
  if (!state.catalog) state.catalog = (await api('/api/catalog')).payload
  return state.catalog
}

async function loadPlan() {
  if (!state.plan || state.plan.date !== state.date) state.plan = (await api('/api/plan?date=' + state.date)).payload
  return state.plan
}

function siteById(id) {
  return state.catalog?.sites.find((site) => site.id === id)
}

async function draw() {
  const { path } = pathOf()
  if (!state.me && path !== '/signin' && path !== '/recover') {
    location.hash = '#/signin'
    return
  }
  if (state.me?.role === 'operator' && (path === '/home' || path.startsWith('/plan') || path.startsWith('/setup') || path.startsWith('/wizard') || path.startsWith('/trigger') || path.startsWith('/tickets'))) {
    location.hash = '#/operator'
    return
  }
  try {
    screenEl().innerHTML = await render(path)
  } catch (error) {
    screenEl().innerHTML = `<p class="banner">${esc(error.message || 'The screen could not load.')}</p>`
  }
}

async function render(path) {
  if (path === '/signin') return signin()
  if (path === '/recover') return recover()
  if (path === '/home') return home()
  if (path === '/account') return account()
  if (path === '/trigger') return trigger()
  if (path === '/outbox') return outbox()
  if (path === '/tickets') return tickets()
  if (path === '/setup') return setupHome()
  if (path === '/setup/units') return unitsScreen()
  if (path === '/setup/machines') return machineList()
  if (path === '/setup/machines/new') return machineForm(null)
  if (path === '/setup/operators') return operatorList()
  if (path === '/setup/operators/new') return operatorForm(null)
  if (path === '/setup/clients') return clientList()
  if (path === '/setup/clients/new') return clientForm(null)
  const machine = path.match(/^\/setup\/machine\/([^/]+)$/)
  if (machine) return machineForm(machine[1])
  const operator = path.match(/^\/setup\/operator\/([^/]+)$/)
  if (operator) return operatorForm(operator[1])
  const client = path.match(/^\/setup\/client\/([^/]+)$/)
  if (client) return clientPage(client[1])
  const site = path.match(/^\/setup\/site\/([^/]+)$/)
  if (site) return siteForm(site[1])
  if (path === '/setup/sites/new') return siteForm(null)
  const plan = path.match(/^\/plan\/(pushing|sanding|hauling)$/)
  if (plan) return planView(plan[1])
  const wizard = path.match(/^\/wizard\/(pushing|sanding|hauling)\/([a-z]+)$/)
  if (wizard) return wizardView(wizard[1], wizard[2])
  const detail = path.match(/^\/stop\/([^/]+)$/)
  if (detail) return stopDetail(detail[1])
  if (path === '/operator') return operatorHome()
  const job = path.match(/^\/operator\/stop\/([^/]+)$/)
  if (job) return operatorStop(job[1])
  const meter = path.match(/^\/operator\/meter\/([^/]+)$/)
  if (meter) return meterScreen(meter[1])
  const swap = path.match(/^\/operator\/breakdown\/([^/]+)$/)
  if (swap) return breakdownScreen(swap[1])
  if (path === '/operator/preference') return preferenceScreen()
  return screen({ title: 'Not found', back: '#/home', body: '' })
}

function signin() {
  return screen({
    kicker: 'Sign in',
    title: 'Day shift',
    lede: 'Use a password or a passkey. Either one signs you in.',
    body: `<form class="stack" data-form="login">
        <label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" required></label>
        <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>
        <button class="primary" type="submit">Sign in</button>
      </form>
      <button class="tap" type="button" data-act="passkey-login"><span class="tap-title">Sign in with a passkey</span><span class="muted">Face or fingerprint on this phone.</span></button>
      <button class="back" type="button" data-go="#/recover">Email a recovery code</button>`,
  })
}

function recover() {
  return screen({
    kicker: 'Recovery',
    title: 'Get back in',
    lede: 'A one-time code is the way back after a lost phone or a forgotten password.',
    back: '#/signin',
    body: `<form class="stack" data-form="recover-request">
        <label class="field"><span>Email</span><input name="email" type="email" required value="${esc(state.recoverEmail || '')}"></label>
        <button class="primary" type="submit">Create a code</button>
      </form>
      ${state.recovery ? `<p class="banner">${esc(state.recovery.notice)}</p><p class="card"><strong>${esc(state.recovery.code)}</strong></p>
        <form class="stack" data-form="recover-verify">
          <label class="field"><span>Code</span><input name="code" inputmode="numeric" required></label>
          <button class="primary" type="submit">Sign in with the code</button>
        </form>` : ''}`,
  })
}

async function home() {
  const plan = await loadPlan()
  const counts = Object.fromEntries(plan.workflows.map((item) => [item.id, plan.stops.filter((stop) => stop.workflow === item.id).length]))
  return screen({
    kicker: state.date,
    title: "Today's plan",
    lede: 'Build the day before anyone rolls out.',
    body: `<div class="row">
        <button class="back" type="button" data-act="shift-date" data-days="-1">Earlier day</button>
        <button class="back" type="button" data-act="shift-date" data-days="1">Later day</button>
      </div>
      ${plan.hasPrevious && !plan.stops.length ? '<button class="tap" type="button" data-act="copy-plan"><span class="tap-title">Start from last storm</span><span class="muted">Copy the previous plan, then adjust it.</span></button>' : ''}
      <div class="stack">
        ${plan.workflows.filter((item) => item.phase === 'snow').map((item) => `<a class="tap" href="#/plan/${item.id}"><span class="tap-title">${esc(item.label)}</span><span class="muted">${counts[item.id] || 0} on the plan</span></a>`).join('')}
        <a class="tap" href="#/trigger"><span class="tap-title">Pull the trigger</span><span class="muted">${plan.day?.triggerResult === 'go' ? 'Already a go' : 'Go or no-go'}</span></a>
        <a class="tap" href="#/outbox"><span class="tap-title">Messages</span><span class="muted">Simulated texts and pushes. Nothing is delivered.</span></a>
        <a class="tap" href="#/tickets"><span class="tap-title">Tickets and export</span></a>
        <a class="tap" href="#/setup"><span class="tap-title">Setup</span></a>
        <a class="tap" href="#/operator"><span class="tap-title">Work a site</span><span class="muted">Step into the operator view.</span></a>
        <a class="tap" href="#/account"><span class="tap-title">Account</span></a>
      </div>`,
  })
}

async function planView(workflow) {
  const plan = await loadPlan()
  const info = plan.workflows.find((item) => item.id === workflow)
  const stops = plan.stops.filter((stop) => stop.workflow === workflow)
  return screen({
    kicker: info.label,
    title: state.date,
    lede: workflow === 'hauling' ? 'Hauls are timed moves, with travel and load buffers.' : workflow === 'sanding' ? 'The sander can cover more than one site at a time.' : 'Overlapping windows run together when the crew is free.',
    back: '#/home',
    body: `${stops.length ? `<ol class="steps">${stops.map((stop, index) => card(stop, index, stops.length)).join('')}</ol>` : '<p class="empty">Nothing on this plan yet.</p>'}
      <a class="primary" href="#/wizard/${workflow}/${workflow === 'hauling' ? 'from' : 'site'}">Add</a>`,
  })
}

function card(stop, index, total) {
  const title = stop.workflow === 'hauling' ? `${stop.fromSiteName} to ${stop.siteName}` : stop.siteName
  return `<li class="card">
    <p class="kicker">${esc(stop.status)}</p>
    <h2>${esc(title)}</h2>
    <p class="muted">${esc(stop.windowLabel)}${stop.releaseLabel ? ` · leave ${esc(stop.releaseLabel)}` : ''}</p>
    ${tags(stop.tags)}
    ${stop.holdReason ? `<p class="banner">${esc(stop.holdReason)}</p>` : ''}
    ${stop.driverNote ? `<p>${esc(stop.driverNote)}</p>` : ''}
    <ul class="crew">${stop.crew.map((seat) => `<li><strong>${esc(seat.operatorLabel)}</strong><span>${esc(seat.machineCode || 'No machine')}</span></li>`).join('')}</ul>
    <div class="arrows">
      <button type="button" data-act="move-stop" data-id="${stop.id}" data-direction="-1" ${index === 0 ? 'disabled' : ''}>Up</button>
      <button type="button" data-act="move-stop" data-id="${stop.id}" data-direction="1" ${index === total - 1 ? 'disabled' : ''}>Down</button>
    </div>
    <a class="back" href="#/stop/${stop.id}">Open</a>
  </li>`
}

async function stopDetail(id) {
  const plan = await loadPlan()
  const stop = plan.stops.find((item) => item.id === id)
  if (!stop) return screen({ title: 'Missing stop', back: '#/home', body: '' })
  const catalog = await ensureCatalog()
  return screen({
    kicker: serviceName(stop.workflow),
    title: stop.siteName,
    lede: stop.windowLabel,
    back: `#/plan/${stop.workflow}`,
    body: `${stop.notes ? `<p>${esc(stop.notes)}</p>` : ''}${stop.hazards ? `<p class="banner">${esc(stop.hazards)}</p>` : ''}
      <ul class="crew">${stop.crew.map((seat) => `<li><strong>${esc(seat.operatorLabel)}</strong><span>${esc(seat.machineCode || 'No machine')}</span></li>`).join('')}</ul>
      <form class="stack" data-form="note">
        <input type="hidden" name="id" value="${stop.id}">
        <label class="field"><span>Crew note</span><textarea name="note">${esc(stop.driverNote)}</textarea></label>
        <button class="primary" type="submit">Save the note</button>
      </form>
      <button class="tap" type="button" data-act="run-long" data-id="${stop.id}" data-minutes="15"><span class="tap-title">Ran 15 minutes long</span></button>
      <button class="tap" type="button" data-act="run-long" data-id="${stop.id}" data-minutes="30"><span class="tap-title">Ran 30 minutes long</span></button>
      <form class="stack" data-form="switch-site">
        <input type="hidden" name="stopId" value="${stop.id}">
        ${stop.crew.map((seat, index) => `<label class="tap"><input type="radio" name="operatorId" value="${seat.operatorId}" ${index === 0 ? 'checked' : ''}> <span class="tap-title">${esc(seat.operatorLabel)}</span></label>`).join('')}
        ${catalog.sites.filter((site) => offers(site, stop.workflow)).map((site) => `<label class="tap"><input type="radio" name="siteId" value="${site.id}"> <span class="tap-title">${esc(site.name)}</span></label>`).join('')}
        <label class="field"><span>New start</span><input name="windowStart" type="time" required value="${esc(stop.windowEnd)}"></label>
        <label class="field"><span>Reason</span><input name="reason" required value="Job ran long"></label>
        <button class="primary" type="submit">Send them on</button>
      </form>
      ${stop.status === 'planned' ? `<button class="back" type="button" data-act="remove-stop" data-id="${stop.id}" data-workflow="${stop.workflow}">Remove from the plan</button>` : ''}`,
  })
}

function offers(site, workflow) {
  return { pushing: site.pushTag, sanding: site.sandTag, hauling: site.haulTag }[workflow] !== 'off'
}

async function wizardView(workflow, step) {
  await ensureCatalog()
  if (!state.draft || state.draft.workflow !== workflow) {
    state.draft = { workflow, operatorIds: [], machines: {}, travelMinutes: 20, loadMinutes: 15, unloadMinutes: 20, releaseAt: '', machineCursor: 0 }
  }
  if (!state.catalog.settings.machineAssignment && step === 'machine') {
    go(`#/wizard/${workflow}/confirm`)
    return ''
  }
  if (step === 'site' || step === 'from' || step === 'to') return pickSite(workflow, step)
  if (step === 'window') return windowStep()
  if (step === 'times') return haulTimes()
  if (step === 'operators') return operatorStep(workflow)
  if (step === 'machine') return machineStep(workflow)
  if (step === 'confirm') return confirmStep(workflow)
  return screen({ title: 'Plan', back: `#/plan/${workflow}`, body: '' })
}

function pickSite(workflow, step) {
  const sites = state.catalog.sites.filter((site) => (step === 'from' ? true : offers(site, workflow)))
  const taken = new Set((state.plan?.stops || []).filter((stop) => stop.workflow === workflow).map((stop) => stop.siteId))
  return screen({
    kicker: serviceName(workflow),
    title: step === 'from' ? 'Where does the truck leave?' : step === 'to' ? 'Which site is the haul for?' : 'Which site is next?',
    back: `#/plan/${workflow}`,
    body: `<div class="stack">${sites.map((site) => {
      const disabled = step !== 'from' && workflow !== 'hauling' && taken.has(site.id)
      return `<button class="tap" type="button" data-act="pick-site" data-step="${step}" data-id="${site.id}" ${disabled ? 'disabled' : ''}>
        <span class="tap-title">${esc(site.name)}</span><span class="muted">${esc(site.address)}</span>${tags(site.tags)}
        ${disabled ? '<span class="muted">Already on this plan</span>' : ''}
        ${site.bylawEarliest ? `<span class="muted">Not before ${esc(site.bylawEarliest)}</span>` : ''}
      </button>`
    }).join('')}</div>`,
  })
}

function windowStep() {
  const site = siteById(state.draft.siteId)
  return screen({
    kicker: site?.name || 'Window',
    title: 'What time?',
    lede: site?.bylawEarliest ? `${site.name} cannot start before ${site.bylawEarliest}.` : 'Use the usual window, or change it.',
    back: `#/wizard/${state.draft.workflow}/site`,
    body: `<form class="stack" data-form="window">
      <label class="field"><span>Start</span><input name="windowStart" type="time" required value="${esc(state.draft.windowStart || site?.windowStart || '05:00')}"></label>
      <label class="field"><span>End</span><input name="windowEnd" type="time" required value="${esc(state.draft.windowEnd || site?.windowEnd || '07:00')}"></label>
      ${state.draft.workflow === 'pushing' ? `<label class="field"><span>Leave for the next site at</span><input name="releaseAt" type="time" value="${esc(state.draft.releaseAt || '')}"></label><p class="muted">Optional. The crew can leave before the site is finished.</p>` : ''}
      <button class="primary" type="submit">Choose operators</button>
    </form>`,
  })
}

function haulTimes() {
  const draft = state.draft
  return screen({
    kicker: 'Haul',
    title: 'Times and buffers',
    back: '#/wizard/hauling/to',
    body: `<form class="stack" data-form="haul-times">
      <label class="field"><span>Depart</span><input name="windowStart" type="time" required value="${esc(draft.windowStart || '10:00')}"></label>
      <label class="field"><span>Load buffer, minutes</span><input name="loadMinutes" type="number" min="0" required value="${esc(draft.loadMinutes)}"></label>
      <label class="field"><span>Travel, minutes</span><input name="travelMinutes" type="number" min="0" required value="${esc(draft.travelMinutes)}"></label>
      <label class="field"><span>Unload buffer, minutes</span><input name="unloadMinutes" type="number" min="0" required value="${esc(draft.unloadMinutes)}"></label>
      <button class="primary" type="submit">Choose operators</button>
    </form>`,
  })
}

async function operatorStep(workflow) {
  const draft = state.draft
  const result = await api(`/api/choices?date=${state.date}&workflow=${workflow}&start=${draft.windowStart}&end=${draft.windowEnd}&release=${draft.releaseAt || ''}`)
  if (result.status !== 200) return screen({ title: 'Operators', back: `#/plan/${workflow}`, body: `<p class="banner">${esc(result.payload.error)}</p>` })
  state.choices = result.payload
  const taken = new Set(result.payload.operators.filter((person) => person.state === 'taken').map((person) => person.id))
  state.draft.operatorIds = state.draft.operatorIds.filter((id) => !taken.has(id))
  return screen({
    kicker: 'Operators',
    title: 'Who is on this site?',
    lede: 'Machines come after this, and only if that step is turned on.',
    back: `#/wizard/${workflow}/${workflow === 'hauling' ? 'times' : 'window'}`,
    body: `${pairingText(draft.operatorIds) ? `<p class="banner">${esc(pairingText(draft.operatorIds))}</p>` : ''}
      <div class="stack">${result.payload.operators.map((person) => `<button type="button" class="tap ${draft.operatorIds.includes(person.id) ? 'is-on' : ''}" data-act="toggle-operator" data-id="${person.id}" ${person.state === 'taken' ? 'disabled' : ''}>
        <span class="tap-title">${esc(person.label)}</span>
        <span class="muted">${esc(person.experience)}</span>
        ${person.suggested ? '<span class="muted">Usual crew</span>' : ''}
        ${person.state === 'taken' ? `<span class="muted">On ${esc(person.where)} in this window</span>` : ''}
        ${person.state === 'coming' ? `<span class="muted">Coming from ${esc(person.where)}</span>` : ''}
        ${person.where && person.state === 'free' ? `<span class="muted">Also at ${esc(person.where)}</span>` : ''}
      </button>`).join('')}</div>
      <button class="primary" type="button" data-act="operators-next" ${draft.operatorIds.length ? '' : 'disabled'}>Continue</button>`,
  })
}

function pairingText(ids) {
  if (ids.length < 2) return ''
  const rows = ids.map((id) => state.catalog.operators.find((person) => person.id === id))
  if (rows.some((person) => person?.experience === 'experienced')) return ''
  return 'This site has no experienced lead.'
}

function machineStep(workflow) {
  const draft = state.draft
  const operatorId = draft.operatorIds[draft.machineCursor || 0]
  const person = state.catalog.operators.find((item) => item.id === operatorId)
  const machines = (state.choices?.machines || []).filter((machine) => machine.state !== 'unneeded')
  return screen({
    kicker: person?.label || 'Machine',
    title: 'Which machine?',
    lede: 'Optional. Skip it if they will jump in whatever is free.',
    back: `#/wizard/${workflow}/operators`,
    body: `<div class="stack">
      <button type="button" class="tap ${draft.machines[operatorId] ? '' : 'is-on'}" data-act="pick-machine" data-id=""><span class="tap-title">No machine</span></button>
      ${machines.map((machine) => `<button type="button" class="tap ${draft.machines[operatorId] === machine.id ? 'is-on' : ''}" data-act="pick-machine" data-id="${machine.id}" ${machine.state === 'taken' ? 'disabled' : ''}>
        <span class="tap-title">${esc(machine.code)} · ${esc(machine.implement)}</span>
        ${person?.usualMachineId === machine.id ? '<span class="muted">Usual machine</span>' : ''}
        ${machine.state === 'taken' ? `<span class="muted">On ${esc(machine.where)} in this window</span>` : ''}
        ${machine.state === 'coming' ? `<span class="muted">Coming from ${esc(machine.where)}</span>` : ''}
      </button>`).join('')}
    </div>
    <button class="primary" type="button" data-act="machine-next">Continue</button>`,
  })
}

function confirmStep(workflow) {
  const draft = state.draft
  const site = siteById(draft.siteId)
  const from = siteById(draft.fromSiteId)
  const people = draft.operatorIds.map((id) => {
    const person = state.catalog.operators.find((item) => item.id === id)
    const machine = state.catalog.machines.find((item) => item.id === draft.machines[id])
    return `${person?.label || 'Operator'}${machine ? ` · ${machine.code}` : ''}`
  }).join(', ')
  return screen({
    kicker: 'Confirm',
    title: site?.name || 'Confirm',
    lede: `${draft.windowStart}–${draft.windowEnd}${workflow === 'hauling' ? `. From ${from?.name || ''}` : ''}`,
    back: `#/wizard/${workflow}/${state.catalog.settings.machineAssignment ? 'machine' : 'operators'}`,
    body: `<div class="card"><p>${esc(people)}</p>${draft.releaseAt ? `<p>Leave at ${esc(draft.releaseAt)}</p>` : ''}${pairingText(draft.operatorIds) ? `<p class="banner">${esc(pairingText(draft.operatorIds))}</p>` : ''}</div>
      <button class="primary" type="button" data-act="save-stop">Add to the plan</button>`,
  })
}

async function trigger() {
  const plan = await loadPlan()
  return screen({
    kicker: 'Go / no-go',
    title: 'Pull the trigger',
    lede: `Threshold is ${plan.settings.snowThreshold} ${plan.settings.snowUnit}. A backup dispatcher can pull this too.`,
    back: '#/home',
    body: `<form class="stack" data-form="trigger">
        <label class="field"><span>Snow fallen (${esc(plan.settings.snowUnit)})</span><input name="snow" type="number" min="0" step="0.1" required></label>
        <button class="primary" type="submit">Pull the trigger — it's a go</button>
      </form>
      ${(state.triggerResult?.messages || []).map((message) => `<article class="card"><p class="kicker">${esc(message.channel)} · not delivered</p><p>${esc(message.body)}</p></article>`).join('')}`,
  })
}

async function outbox() {
  const result = await api('/api/messages?date=' + state.date)
  const messages = result.payload.messages || []
  return screen({
    kicker: 'Outbox',
    title: 'Messages',
    lede: 'These are the texts and pushes that would be sent. None of them were delivered to a phone.',
    back: state.me.role === 'dispatcher' ? '#/home' : '#/operator',
    body: messages.length ? messages.map((message) => `<article class="card"><p class="kicker">${esc(message.channel)} · ${esc(message.kind)} · not delivered</p><p>${esc(message.body)}</p></article>`).join('') : '<p class="empty">No messages for this day.</p>',
  })
}

async function tickets() {
  const result = await api('/api/tickets?date=' + state.date)
  const rows = result.payload.tickets || []
  return screen({
    kicker: 'Records',
    title: 'Tickets',
    lede: 'Two loaders on one site are one occurrence. Nothing is sent on its own.',
    back: '#/home',
    body: `${rows.map((ticket) => `<article class="card"><h2>${esc(ticket.siteName)}</h2><p>${esc(serviceName(ticket.workflow))} · ${esc(ticket.hours)} h</p><p class="muted">${esc(ticket.billingNote)}</p><p>${esc(ticket.operators.join(', '))}</p></article>`).join('') || '<p class="empty">No tickets yet.</p>'}
      <button class="primary" type="button" data-act="download" data-path="/api/export/dispatcher?date=${state.date}" data-file="dispatcher-export.csv">Dispatcher export</button>`,
  })
}

async function setupHome() {
  const catalog = await ensureCatalog()
  return screen({
    kicker: 'Setup',
    title: 'Fleet, crew, clients',
    lede: `Units are ${catalog.settings.units}. Machine assignment is ${catalog.settings.machineAssignment ? 'on' : 'off'}.`,
    back: '#/home',
    body: `<div class="stack">
      <a class="tap" href="#/setup/units"><span class="tap-title">Units and settings</span></a>
      <a class="tap" href="#/setup/machines"><span class="tap-title">Machines</span><span class="muted">${catalog.machines.length} in the fleet</span></a>
      <a class="tap" href="#/setup/operators"><span class="tap-title">Operators</span></a>
      <a class="tap" href="#/setup/clients"><span class="tap-title">Clients and sites</span></a>
    </div>`,
  })
}

async function unitsScreen() {
  const settings = (await ensureCatalog()).settings
  if (state.editorKey !== 'units') {
    state.editorKey = 'units'
    state.form = { units: settings.units, machineAssignment: settings.machineAssignment ? '1' : '0', snowThreshold: settings.snowThreshold }
  }
  return screen({
    kicker: 'Setup',
    title: 'Units',
    lede: 'Imperial is the default.',
    back: '#/setup',
    body: `${choice('units', [['imperial', 'Imperial'], ['metric', 'Metric']])}
      ${choice('machineAssignment', [['0', 'Machines off'], ['1', 'Machines on']])}
      <p class="muted">When machines are on, the order is operator first, then machine.</p>
      <form class="stack" data-form="save-units">
        <label class="field"><span>Snow threshold (${esc(settings.snowUnit)})</span><input name="snowThreshold" type="number" min="0" step="0.1" value="${esc(state.form.snowThreshold)}"></label>
        <button class="primary" type="submit">Save settings</button>
      </form>`,
  })
}

function choice(key, options) {
  return `<div class="stack">${options.map(([value, label]) => `<button type="button" class="tap ${String(state.form[key]) === value ? 'is-on' : ''}" data-act="set-form" data-key="${key}" data-value="${value}"><span class="tap-title">${esc(label)}</span></button>`).join('')}</div>`
}

async function machineList() {
  const catalog = await ensureCatalog()
  return screen({
    kicker: 'Fleet',
    title: 'Machines',
    back: '#/setup',
    body: `<div class="stack">${catalog.machines.map((machine) => `<a class="tap" href="#/setup/machine/${machine.id}"><span class="tap-title">${esc(machine.code)}</span><span class="muted">${esc(machine.implement)}</span></a>`).join('')}</div>
      <a class="primary" href="#/setup/machines/new">Add a machine</a>`,
  })
}

async function machineForm(id) {
  const catalog = await ensureCatalog()
  const existing = catalog.machines.find((machine) => machine.id === id)
  if (state.editorKey !== `machine:${id || 'new'}`) {
    state.editorKey = `machine:${id || 'new'}`
    state.form = {
      code: existing?.code || '',
      type: existing?.type || 'loader',
      implement: existing?.implement || '',
      trackHours: existing ? (existing.trackHours == null ? '' : existing.trackHours ? '1' : '0') : '1',
      trackKm: existing ? (existing.trackKm == null ? '' : existing.trackKm ? '1' : '0') : '0',
      lastHours: existing?.lastHours ?? '',
      lastKm: existing?.lastKm ?? '',
    }
  }
  return screen({
    kicker: 'Machine',
    title: existing ? existing.code : 'New machine',
    lede: state.form.type === 'haul_truck' ? 'Hours and kilometres for haul trucks are still an open question.' : 'Loaders track hours. The sander tracks kilometres.',
    back: '#/setup/machines',
    body: `<form class="stack" data-form="save-machine">
        <label class="field"><span>Id</span><input name="code" required value="${esc(state.form.code)}"></label>
        <label class="field"><span>Implement</span><input name="implement" value="${esc(state.form.implement)}"></label>
        <label class="field"><span>Last hours</span><input name="lastHours" type="number" step="0.1" value="${esc(state.form.lastHours)}"></label>
        <label class="field"><span>Last kilometres</span><input name="lastKm" type="number" step="0.1" value="${esc(state.form.lastKm)}"></label>
        <button class="primary" type="submit" data-id="${esc(id || '')}">Save machine</button>
      </form>
      ${choice('type', [['loader', 'Loader'], ['sander', 'Sander'], ['haul_truck', 'Haul truck']])}
      <p class="kicker">Track hours</p>${choice('trackHours', [['', 'Not confirmed'], ['1', 'On'], ['0', 'Off']])}
      <p class="kicker">Track kilometres</p>${choice('trackKm', [['', 'Not confirmed'], ['1', 'On'], ['0', 'Off']])}
      ${id ? `<button class="back" type="button" data-act="archive" data-kind="machines" data-id="${esc(id)}">Remove from the fleet</button>` : ''}`,
  })
}

async function operatorList() {
  const catalog = await ensureCatalog()
  return screen({
    kicker: 'Crew',
    title: 'Operators',
    back: '#/setup',
    body: `<div class="stack">${catalog.operators.map((person) => `<a class="tap" href="#/setup/operator/${person.id}"><span class="tap-title">${esc(person.label)}</span><span class="muted">${esc(person.experience)}</span></a>`).join('')}</div>
      <a class="primary" href="#/setup/operators/new">Add an operator</a>`,
  })
}

async function operatorForm(id) {
  const catalog = await ensureCatalog()
  const existing = catalog.operators.find((person) => person.id === id)
  if (state.editorKey !== `operator:${id || 'new'}`) {
    if (state.passwordFor !== id) state.createdPassword = ''
    state.editorKey = `operator:${id || 'new'}`
    state.form = {
      label: existing?.label || '',
      experience: existing?.experience || 'experienced',
      usualMachineId: existing?.usualMachineId || '',
      phone: existing?.phone || '',
      email: existing?.email || '',
      notifyJobEdges: existing ? (existing.notifyJobEdges == null ? '' : existing.notifyJobEdges ? '1' : '0') : '',
    }
  }
  return screen({
    kicker: 'Operator',
    title: existing?.label || 'New operator',
    lede: 'Job start and end notices are still an open question. The go call is separate.',
    back: '#/setup/operators',
    body: `<form class="stack" data-form="save-operator">
        <label class="field"><span>Label</span><input name="label" required value="${esc(state.form.label)}"></label>
        <label class="field"><span>Phone for texts</span><input name="phone" value="${esc(state.form.phone)}"></label>
        <label class="field"><span>Email for recovery</span><input name="email" type="email" value="${esc(state.form.email)}"></label>
        <button class="primary" type="submit" data-id="${esc(id || '')}">Save operator</button>
      </form>
      ${choice('experience', [['experienced', 'Experienced'], ['inexperienced', 'Inexperienced']])}
      <p class="kicker">Usual machine</p>
      <button type="button" class="tap ${state.form.usualMachineId ? '' : 'is-on'}" data-act="set-form" data-key="usualMachineId" data-value=""><span class="tap-title">None</span></button>
      ${catalog.machines.map((machine) => `<button type="button" class="tap ${state.form.usualMachineId === machine.id ? 'is-on' : ''}" data-act="set-form" data-key="usualMachineId" data-value="${machine.id}"><span class="tap-title">${esc(machine.code)}</span></button>`).join('')}
      <p class="kicker">Job start / end</p>
      ${choice('notifyJobEdges', [['', 'Not confirmed'], ['1', 'Notify'], ['0', 'Silent update']])}
      ${state.createdPassword ? `<p class="banner">Not emailed. Share this password: ${esc(state.createdPassword)}</p>` : ''}
      ${id ? `<button class="back" type="button" data-act="archive" data-kind="operators" data-id="${esc(id)}">Remove operator</button>` : ''}`,
  })
}

async function clientList() {
  const catalog = await ensureCatalog()
  return screen({
    kicker: 'Clients',
    title: 'Clients',
    back: '#/setup',
    body: `<div class="stack">${catalog.clients.map((client) => `<a class="tap" href="#/setup/client/${client.id}"><span class="tap-title">${esc(client.name)}</span><span class="muted">${client.billing === 'hourly' ? 'Hourly' : 'Flat rate per occurrence'}</span></a>`).join('')}</div>
      <a class="primary" href="#/setup/clients/new">Add a client</a>`,
  })
}

async function clientPage(id) {
  const catalog = await ensureCatalog()
  const client = catalog.clients.find((item) => item.id === id)
  if (!client) return clientForm(null)
  const sites = catalog.sites.filter((site) => site.clientId === id)
  return screen({
    kicker: client.billing === 'hourly' ? 'Hourly' : 'Flat rate',
    title: client.name,
    lede: client.contactRole,
    back: '#/setup/clients',
    body: `<p>${esc(client.phone)} · ${esc(client.email)}</p>
      <div class="stack">${sites.map((site) => `<a class="tap" href="#/setup/site/${site.id}"><span class="tap-title">${esc(site.name)}</span>${tags(site.tags)}</a>`).join('')}</div>
      <a class="tap" href="#/setup/sites/new?client=${client.id}"><span class="tap-title">Add a site</span></a>
      <button class="primary" type="button" data-act="download" data-path="/api/clients/${client.id}/export" data-file="client-export.csv">Client export</button>`,
  })
}

async function clientForm() {
  await ensureCatalog()
  if (state.editorKey !== 'client:new') {
    state.editorKey = 'client:new'
    state.form = { billing: 'flat' }
  }
  return screen({
    kicker: 'Client',
    title: 'New client',
    back: '#/setup/clients',
    body: `${choice('billing', [['flat', 'Flat rate per occurrence'], ['hourly', 'Hourly']])}
      <form class="stack" data-form="save-client">
        <label class="field"><span>Name</span><input name="name" required></label>
        <label class="field"><span>Contact role</span><input name="contactRole" value="Accounts desk"></label>
        <label class="field"><span>Phone</span><input name="phone"></label>
        <label class="field"><span>Email</span><input name="email"></label>
        <button class="primary" type="submit">Save client</button>
      </form>`,
  })
}

async function siteForm(id) {
  const catalog = await ensureCatalog()
  const { params } = pathOf()
  const existing = catalog.sites.find((site) => site.id === id)
  if (state.editorKey !== `site:${id || 'new'}`) {
    state.editorKey = `site:${id || 'new'}`
    state.form = existing ? { ...existing } : {
      clientId: params.get('client') || catalog.clients[0]?.id || '',
      pushTag: 'automatic', sandTag: 'automatic', haulTag: 'off',
    }
  }
  const areaUnit = catalog.settings.units === 'metric' ? 'm²' : 'sq ft'
  const sandUnit = catalog.settings.units === 'metric' ? 'm³' : 'yd'
  const form = state.form
  return screen({
    kicker: 'Site',
    title: existing?.name || 'New site',
    back: `#/setup/client/${form.clientId}`,
    body: `<div class="stack">${catalog.clients.map((client) => `<button type="button" class="tap ${form.clientId === client.id ? 'is-on' : ''}" data-act="set-form" data-key="clientId" data-value="${client.id}"><span class="tap-title">${esc(client.name)}</span></button>`).join('')}</div>
      <form class="stack" data-form="save-site">
        <label class="field"><span>Name</span><input name="name" required value="${esc(form.name || '')}"></label>
        <label class="field"><span>Address</span><input name="address" value="${esc(form.address || '')}"></label>
        <label class="field"><span>Usual start</span><input name="windowStart" type="time" value="${esc(form.windowStart || '05:00')}"></label>
        <label class="field"><span>Usual end</span><input name="windowEnd" type="time" value="${esc(form.windowEnd || '07:00')}"></label>
        <label class="field"><span>Noise bylaw earliest</span><input name="bylawEarliest" type="time" value="${esc(form.bylawEarliest || '')}"></label>
        <label class="field"><span>Area (${esc(areaUnit)})</span><input name="area" type="number" step="0.01" value="${esc(form.area ?? '')}"></label>
        <label class="field"><span>Default sand (${esc(sandUnit)})</span><input name="defaultSand" type="number" step="0.01" value="${esc(form.defaultSand ?? '')}"></label>
        <label class="field"><span>Hazards</span><input name="hazards" value="${esc(form.hazards || '')}"></label>
        <label class="field"><span>Notes</span><textarea name="notes">${esc(form.notes || '')}</textarea></label>
        <button class="primary" type="submit" data-id="${esc(id || '')}">Save site</button>
      </form>
      <p class="kicker">Pushing</p>${choice('pushTag', [['automatic', 'Automatic'], ['on_call', 'On call'], ['off', 'Not offered']])}
      <p class="kicker">Sanding</p>${choice('sandTag', [['automatic', 'Automatic'], ['on_call', 'On call'], ['off', 'Not offered']])}
      <p class="kicker">Hauling</p>${choice('haulTag', [['automatic', 'Automatic'], ['on_call', 'On call'], ['off', 'Not offered']])}`,
  })
}

function account() {
  return screen({
    kicker: state.me.role,
    title: 'Account',
    lede: state.me.email,
    back: state.me.role === 'dispatcher' ? '#/home' : '#/operator',
    body: `<form class="stack" data-form="password">
        <label class="field"><span>New password</span><input name="password" type="password" minlength="10" required></label>
        <button class="primary" type="submit">Save password</button>
      </form>
      <button class="tap" type="button" data-act="add-passkey"><span class="tap-title">Add a passkey</span></button>
      <button class="tap" type="button" data-act="enable-push"><span class="tap-title">Allow notifications</span><span class="muted">Saved here. Pushes are only logged.</span></button>
      <button class="back" type="button" data-act="logout">Sign out</button>`,
  })
}

async function operatorHome() {
  await ensureCatalog()
  if (state.me.role === 'dispatcher' && !state.actingAs) {
    return screen({
      kicker: 'Operator view',
      title: 'Who are you working as?',
      back: '#/home',
      body: `<div class="stack">${state.catalog.operators.map((person) => `<button class="tap" type="button" data-act="act-as" data-id="${person.id}"><span class="tap-title">${esc(person.label)}</span></button>`).join('')}</div>`,
    })
  }
  const operatorId = await currentOperatorId()
  const plan = (await api(`/api/operator?date=${state.date}&operatorId=${operatorId}`)).payload
  return screen({
    kicker: plan.operator.label,
    title: 'Your sites',
    lede: plan.day?.weatherNote ? `Weather: ${plan.day.weatherNote}` : 'Weather note is once for the day.',
    back: state.me.role === 'dispatcher' ? '#/home' : '',
    body: `${plan.stops.map((stop) => `<a class="tap" href="#/operator/stop/${stop.id}"><span class="tap-title">${esc(stop.workflow === 'hauling' && stop.fromSiteName ? `${stop.fromSiteName} to ${stop.siteName}` : stop.siteName)}</span><span class="muted">${esc(stop.windowLabel)} · ${esc(stop.status)}</span></a>`).join('') || '<p class="empty">Nothing assigned.</p>'}
      <form class="stack" data-form="weather">
        <label class="field"><span>Day's weather</span><input name="note" value="${esc(plan.day?.weatherNote || '')}"></label>
        <button class="primary" type="submit">Save weather</button>
      </form>
      <a class="tap" href="#/operator/preference"><span class="tap-title">Job start and end notices</span><span class="muted">${plan.operator.notifyJobEdges == null ? 'Not confirmed' : plan.operator.notifyJobEdges ? 'Notify' : 'Silent'}</span></a>
      <a class="tap" href="#/outbox"><span class="tap-title">Messages</span><span class="muted">Not delivered to this phone.</span></a>
      ${state.me.role === 'dispatcher' ? '<button class="back" type="button" data-act="clear-acting">Switch operator</button>' : '<a class="back" href="#/account">Account</a>'}`,
  })
}

function currentOperatorId() {
  return state.me.role === 'operator' ? state.me.operatorId : state.actingAs
}

async function operatorStop(id) {
  const operatorId = currentOperatorId()
  const plan = (await api(`/api/operator?date=${state.date}&operatorId=${operatorId}`)).payload
  const stop = plan.stops.find((item) => item.id === id)
  if (!stop) return screen({ title: 'Not on your list', back: '#/operator', body: '' })
  const ticket = (await api(`/api/operator/ticket?stopId=${id}&operatorId=${operatorId}`)).payload.ticket
  const nextEdge = !ticket?.clockIn ? 'in' : !ticket.clockOut ? 'out' : !ticket.clockIn2 ? 'in2' : !ticket.clockOut2 ? 'out2' : ''
  const edgeLabel = { in: 'Clock in', out: 'Clock out', in2: 'Clock in again', out2: 'Clock out again' }[nextEdge]
  const steps = (await ensureCatalog()).sandSteps || []
  return screen({
    kicker: serviceName(stop.workflow),
    title: stop.siteName,
    lede: `${stop.windowLabel} · ${stop.status}`,
    back: '#/operator',
    body: `${stop.hazards ? `<p class="banner">${esc(stop.hazards)}</p>` : ''}${stop.notes ? `<p>${esc(stop.notes)}</p>` : ''}
      ${stop.holdReason ? `<p class="banner">${esc(stop.holdReason)}</p>` : ''}
      ${nextEdge ? `<button class="primary" type="button" data-act="clock" data-id="${stop.id}" data-edge="${nextEdge}">${edgeLabel}</button>` : '<p class="ok">Both visits are clocked.</p>'}
      <a class="tap" href="#/operator/meter/${stop.id}"><span class="tap-title">Meter reading</span></a>
      ${stop.workflow === 'sanding' ? steps.map((step) => `<button class="tap" type="button" data-act="set-sand" data-id="${stop.id}" data-yards="${step.yards}"><span class="tap-title">${esc(step.label)}</span></button>`).join('') : ''}
      ${stop.workflow === 'hauling' ? `<button class="tap" type="button" data-act="add-load" data-id="${stop.id}"><span class="tap-title">Add a load</span><span class="muted">${ticket?.loads || 0} loads</span></button>` : ''}
      <form class="stack" data-form="note"><input type="hidden" name="id" value="${stop.id}"><label class="field"><span>Note for the crew</span><textarea name="note">${esc(stop.driverNote)}</textarea></label><button class="primary" type="submit">Save note</button></form>
      <a class="tap" href="#/operator/breakdown/${stop.id}"><span class="tap-title">Breakdown — swap machine</span></a>`,
  })
}

async function meterScreen(stopId) {
  const operatorId = currentOperatorId()
  const plan = (await api(`/api/operator?date=${state.date}&operatorId=${operatorId}`)).payload
  const stop = plan.stops.find((item) => item.id === stopId)
  const catalog = await ensureCatalog()
  const seat = stop?.crew.find((item) => item.operatorId === operatorId)
  const machines = catalog.machines.filter((machine) => machine.type === { pushing: 'loader', sanding: 'sander', hauling: 'haul_truck' }[stop?.workflow])
  const selected = state.meterMachine || seat?.machineId || machines[0]?.id || ''
  const machine = catalog.machines.find((item) => item.id === selected)
  const confirmed = machine && machine.trackHours != null && machine.trackKm != null
  return screen({
    kicker: 'Meter',
    title: machine ? machine.code : 'Get into a machine',
    lede: 'The starting number is the last meter. A lower number is rejected.',
    back: `#/operator/stop/${stopId}`,
    body: `${machines.map((item) => `<button type="button" class="tap ${item.id === selected ? 'is-on' : ''}" data-act="choose-meter-machine" data-id="${item.id}" ${seat?.machineId && seat.machineId !== item.id ? 'disabled' : ''}><span class="tap-title">${esc(item.code)}</span></button>`).join('')}
      ${machine && !confirmed ? '<p class="banner">Meter tracking for this machine is not confirmed.</p>' : ''}
      ${confirmed ? `<form class="stack" data-form="meter-start">
        <input type="hidden" name="stopId" value="${stopId}"><input type="hidden" name="machineId" value="${machine.id}">
        ${machine.trackHours ? `<label class="field"><span>Starting hours</span><input name="hours" type="number" step="0.1" required value="${esc(machine.lastHours ?? '')}"></label>` : ''}
        ${machine.trackKm ? `<label class="field"><span>Starting kilometres</span><input name="km" type="number" step="0.1" required value="${esc(machine.lastKm ?? '')}"></label>` : ''}
        <button class="primary" type="submit">Confirm starting reading</button>
      </form>
      <form class="stack" data-form="meter-end">
        <input type="hidden" name="stopId" value="${stopId}"><input type="hidden" name="machineId" value="${machine.id}">
        ${machine.trackHours ? '<label class="field"><span>Ending hours</span><input name="hours" type="number" step="0.1"></label>' : ''}
        ${machine.trackKm ? '<label class="field"><span>Ending kilometres</span><input name="km" type="number" step="0.1"></label>' : ''}
        <button class="primary" type="submit">Save ending reading</button>
      </form>` : ''}`,
  })
}

async function breakdownScreen(stopId) {
  const operatorId = currentOperatorId()
  const plan = (await api(`/api/operator?date=${state.date}&operatorId=${operatorId}`)).payload
  const stop = plan.stops.find((item) => item.id === stopId)
  const catalog = await ensureCatalog()
  const seat = stop?.crew.find((item) => item.operatorId === operatorId)
  const current = catalog.machines.find((item) => item.id === seat?.machineId)
  const options = catalog.machines.filter((item) => current && item.type === current.type && item.id !== current.id)
  if (state.editorKey !== `break:${stopId}`) {
    state.editorKey = `break:${stopId}`
    state.form = { toMachineId: options[0]?.id || '' }
  }
  const next = options.find((item) => item.id === state.form.toMachineId)
  return screen({
    kicker: 'Breakdown',
    title: current ? `Leave ${current.code}` : 'No machine yet',
    lede: 'The dispatcher sees the swap. The notice is logged, not sent.',
    back: `#/operator/stop/${stopId}`,
    body: `${options.map((item) => `<button type="button" class="tap ${state.form.toMachineId === item.id ? 'is-on' : ''}" data-act="set-form" data-key="toMachineId" data-value="${item.id}"><span class="tap-title">${esc(item.code)}</span></button>`).join('')}
      <form class="stack" data-form="breakdown">
        <input type="hidden" name="stopId" value="${stopId}">
        ${current?.trackHours ? '<label class="field"><span>Ending hours</span><input name="endHours" type="number" step="0.1"></label>' : ''}
        ${current?.trackKm ? '<label class="field"><span>Ending kilometres</span><input name="endKm" type="number" step="0.1"></label>' : ''}
        ${next?.trackHours ? `<label class="field"><span>Starting hours</span><input name="startHours" type="number" step="0.1" value="${esc(next.lastHours ?? '')}"></label>` : ''}
        ${next?.trackKm ? `<label class="field"><span>Starting kilometres</span><input name="startKm" type="number" step="0.1" value="${esc(next.lastKm ?? '')}"></label>` : ''}
        <label class="field"><span>Note</span><input name="note" value="Breakdown — swap loader"></label>
        <button class="primary" type="submit">Swap machine</button>
      </form>`,
  })
}

async function preferenceScreen() {
  const operatorId = currentOperatorId()
  const person = (await api(`/api/operator?date=${state.date}&operatorId=${operatorId}`)).payload.operator
  if (state.editorKey !== `pref:${operatorId}`) {
    state.editorKey = `pref:${operatorId}`
    state.form = { notifyJobEdges: person.notifyJobEdges == null ? '' : person.notifyJobEdges ? '1' : '0' }
  }
  return screen({
    kicker: 'Open question',
    title: 'Job start and end',
    lede: 'Not confirmed with the dispatcher. The go call always goes out. This only covers a job starting or ending.',
    back: '#/operator',
    body: `${choice('notifyJobEdges', [['', 'Not confirmed'], ['1', 'Notify me'], ['0', 'Update quietly']])}
      <button class="primary" type="button" data-act="save-preference">Save preference</button>`,
  })
}

function fail(message) {
  state.error = message || 'That did not work.'
  state.notice = ''
  state.holdNotice = false
  draw()
}

async function signedIn(user) {
  state.me = user
  state.error = ''
  state.catalog = null
  state.plan = null
  if (!state.date) {
    const me = await api('/api/me')
    state.date = me.payload.today || ''
  }
  go(user.role === 'dispatcher' ? '#/home' : '#/operator')
}

function numberOrNull(input) {
  if (input == null || input === '') return null
  return Number(input)
}

function minutesOf(value) {
  const [hour, minute] = String(value).split(':').map(Number)
  return hour * 60 + minute
}

function formatMinutes(total) {
  const hour = Math.floor(total / 60) % 24
  const minute = total % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function vapidKey(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index)
  return output
}

const actions = {
  async login(data) {
    const result = await api('/api/auth/login', { method: 'POST', body: data })
    if (result.status !== 200) return fail(result.payload.error)
    await signedIn(result.payload.user)
  },
  async 'passkey-login'() {
    try {
      const options = await api('/api/passkey/login/options', { method: 'POST', body: {} })
      const credential = await startAuthentication({ optionsJSON: options.payload })
      const result = await api('/api/passkey/login/verify', { method: 'POST', body: credential })
      if (result.status !== 200) return fail(result.payload.error)
      await signedIn(result.payload.user)
    } catch (error) {
      fail(error.message || 'The passkey was not accepted.')
    }
  },
  async 'recover-request'(data) {
    const result = await api('/api/auth/recovery/request', { method: 'POST', body: data })
    if (result.status !== 200) return fail(result.payload.error)
    state.recoverEmail = data.email
    state.recovery = result.payload
    draw()
  },
  async 'recover-verify'(data) {
    const result = await api('/api/auth/recovery/verify', { method: 'POST', body: { email: state.recoverEmail, code: data.code } })
    if (result.status !== 200) return fail(result.payload.error)
    await signedIn(result.payload.user)
  },
  'shift-date'(button) {
    const [year, month, day] = state.date.split('-').map(Number)
    state.date = new Date(Date.UTC(year, month - 1, day + Number(button.dataset.days))).toISOString().slice(0, 10)
    state.plan = null
    draw()
  },
  async 'copy-plan'() {
    const result = await api('/api/plan/copy', { method: 'POST', body: { date: state.date } })
    if (result.status !== 200) return fail(result.payload.error)
    state.plan = result.payload
    go('#/home', 'Copied the previous plan.')
  },
  async 'move-stop'(button) {
    const result = await api(`/api/stops/${button.dataset.id}/move`, { method: 'POST', body: { direction: Number(button.dataset.direction) } })
    if (result.status !== 200) return fail(result.payload.error)
    state.plan = null
    state.error = ''
    draw()
  },
  async 'remove-stop'(button) {
    const result = await api(`/api/stops/${button.dataset.id}`, { method: 'DELETE' })
    if (result.status !== 200) return fail(result.payload.error)
    state.plan = null
    go(`#/plan/${button.dataset.workflow}`)
  },
  async note(data) {
    const result = await api(`/api/stops/${data.id}/note`, { method: 'POST', body: { note: data.note } })
    if (result.status !== 200) return fail(result.payload.error)
    state.plan = null
    go(location.hash, 'Note saved.')
  },
  async 'run-long'(button) {
    const result = await api(`/api/stops/${button.dataset.id}/long`, { method: 'POST', body: { minutes: Number(button.dataset.minutes) } })
    if (result.status !== 200) return fail(result.payload.error)
    state.plan = null
    const plan = await loadPlan()
    const stop = plan.stops.find((item) => item.id === button.dataset.id)
    go(`#/plan/${stop?.workflow || 'pushing'}`, 'The later stops moved.')
  },
  async 'switch-site'(data) {
    const result = await api(`/api/stops/${data.stopId}/switch`, { method: 'POST', body: data })
    if (result.status !== 200) return fail(result.payload.error)
    state.plan = null
    go(`#/plan/${result.payload.workflow}`, 'New go logged. It was not sent to a phone.')
  },
  'pick-site'(button) {
    if (button.dataset.step === 'from') state.draft.fromSiteId = button.dataset.id
    else {
      state.draft.siteId = button.dataset.id
      const site = siteById(button.dataset.id)
      state.draft.windowStart = site.windowStart || '05:00'
      state.draft.windowEnd = site.windowEnd || '07:00'
    }
    const next = button.dataset.step === 'from' ? 'to' : button.dataset.step === 'to' ? 'times' : 'window'
    go(`#/wizard/${state.draft.workflow}/${next}`)
  },
  window(data) {
    const changed = data.windowStart !== state.draft.windowStart || data.windowEnd !== state.draft.windowEnd || (data.releaseAt || '') !== (state.draft.releaseAt || '')
    Object.assign(state.draft, data)
    if (changed) {
      state.draft.operatorIds = []
      state.draft.machines = {}
      state.draft.machineCursor = 0
    }
    go(`#/wizard/${state.draft.workflow}/operators`)
  },
  'haul-times'(data) {
    Object.assign(state.draft, data)
    state.draft.windowEnd = formatMinutes(minutesOf(data.windowStart) + Number(data.loadMinutes) + Number(data.travelMinutes) + Number(data.unloadMinutes))
    go('#/wizard/hauling/operators')
  },
  'toggle-operator'(button) {
    const id = button.dataset.id
    const list = state.draft.operatorIds
    state.draft.operatorIds = list.includes(id) ? list.filter((item) => item !== id) : [...list, id]
    draw()
  },
  'operators-next'() {
    state.draft.machineCursor = 0
    go(`#/wizard/${state.draft.workflow}/${state.catalog.settings.machineAssignment ? 'machine' : 'confirm'}`)
  },
  'pick-machine'(button) {
    const operatorId = state.draft.operatorIds[state.draft.machineCursor || 0]
    state.draft.machines[operatorId] = button.dataset.id || null
    draw()
  },
  'machine-next'() {
    const cursor = (state.draft.machineCursor || 0) + 1
    if (cursor < state.draft.operatorIds.length) {
      state.draft.machineCursor = cursor
      draw()
      return
    }
    go(`#/wizard/${state.draft.workflow}/confirm`)
  },
  async 'save-stop'() {
    const draft = state.draft
    const result = await api('/api/stops', { method: 'POST', body: { ...draft, date: state.date } })
    if (result.status !== 200) return fail(result.payload.error)
    state.draft = null
    state.plan = null
    go(`#/plan/${draft.workflow}`, result.payload.warning || 'Added to the plan.')
  },
  async trigger(data) {
    const result = await api('/api/trigger', { method: 'POST', body: { date: state.date, snow: Number(data.snow) } })
    if (result.status !== 200) return fail(result.payload.error)
    state.triggerResult = result.payload
    state.plan = null
    state.notice = result.payload.result === 'go' ? 'Go logged. Nothing was sent to a phone.' : 'No-go. Hold messages were logged, not sent.'
    draw()
  },
  async download(button) {
    const response = await fetch(button.dataset.path, { credentials: 'include', headers: { 'x-kakwa': '1' } })
    if (!response.ok) return fail('The export failed.')
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = button.dataset.file
    link.click()
    URL.revokeObjectURL(url)
  },
  'set-form'(button) {
    captureForm()
    state.form[button.dataset.key] = button.dataset.value
    draw()
  },
  async 'save-units'(data) {
    const result = await api('/api/settings', { method: 'PATCH', body: {
      units: state.form.units,
      machineAssignment: state.form.machineAssignment === '1',
      snowThreshold: Number(data.snowThreshold),
    } })
    if (result.status !== 200) return fail(result.payload.error)
    state.catalog = null
    state.plan = null
    state.editorKey = ''
    go('#/setup', 'Settings saved.')
  },
  async 'save-machine'(data) {
    const id = document.querySelector('[data-form="save-machine"] button').dataset.id
    const tri = (value) => (value === '' ? null : value === '1')
    const result = await api(id ? `/api/machines/${id}` : '/api/machines', {
      method: id ? 'PATCH' : 'POST',
      body: { ...data, type: state.form.type, trackHours: tri(state.form.trackHours), trackKm: tri(state.form.trackKm) },
    })
    if (result.status !== 200) return fail(result.payload.error)
    state.catalog = null
    state.editorKey = ''
    go('#/setup/machines', 'Machine saved.')
  },
  async 'save-operator'(data) {
    const id = document.querySelector('[data-form="save-operator"] button').dataset.id
    const result = await api(id ? `/api/operators/${id}` : '/api/operators', {
      method: id ? 'PATCH' : 'POST',
      body: {
        ...data,
        experience: state.form.experience,
        usualMachineId: state.form.usualMachineId,
        notifyJobEdges: state.form.notifyJobEdges === '' ? null : state.form.notifyJobEdges === '1',
      },
    })
    if (result.status !== 200) return fail(result.payload.error)
    state.catalog = null
    state.createdPassword = result.payload.initialPassword || ''
    state.passwordFor = result.payload.id
    state.editorKey = ''
    go(`#/setup/operator/${result.payload.id}`, result.payload.initialPassword ? 'Not emailed. The password is on this screen.' : 'Operator saved.')
  },
  async 'save-client'(data) {
    const result = await api('/api/clients', { method: 'POST', body: { ...data, billing: state.form.billing } })
    if (result.status !== 200) return fail(result.payload.error)
    state.catalog = null
    state.editorKey = ''
    go(`#/setup/client/${result.payload.id}`, 'Client saved.')
  },
  async 'save-site'(data) {
    const id = document.querySelector('[data-form="save-site"] button').dataset.id
    const result = await api(id ? `/api/sites/${id}` : '/api/sites', {
      method: id ? 'PATCH' : 'POST',
      body: { ...data, clientId: state.form.clientId, pushTag: state.form.pushTag, sandTag: state.form.sandTag, haulTag: state.form.haulTag },
    })
    if (result.status !== 200) return fail(result.payload.error)
    state.catalog = null
    state.editorKey = ''
    go(`#/setup/client/${result.payload.clientId}`, 'Site saved.')
  },
  async archive(button) {
    const result = await api(`/api/${button.dataset.kind}/${button.dataset.id}`, { method: 'DELETE' })
    if (result.status !== 200) return fail(result.payload.error)
    state.catalog = null
    go('#/setup', 'Removed.')
  },
  async password(data) {
    const result = await api('/api/me/password', { method: 'POST', body: data })
    if (result.status !== 200) return fail(result.payload.error)
    go('#/account', 'Password saved.')
  },
  async 'add-passkey'() {
    try {
      const options = await api('/api/passkey/register/options', { method: 'POST', body: {} })
      const credential = await startRegistration({ optionsJSON: options.payload })
      const result = await api('/api/passkey/register/verify', { method: 'POST', body: credential })
      if (result.status !== 200) return fail(result.payload.error)
      go('#/account', 'Passkey saved on this phone.')
    } catch (error) {
      fail(error.message || 'The passkey was not saved.')
    }
  },
  async 'enable-push'() {
    const catalog = await ensureCatalog()
    const ready = await navigator.serviceWorker.ready
    const subscription = await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey(catalog.settings.vapidPublic) })
    const result = await api('/api/push/subscribe', { method: 'POST', body: subscription.toJSON() })
    if (result.status !== 200) return fail(result.payload.error)
    go('#/account', result.payload.notice)
  },
  async logout() {
    await api('/api/auth/logout', { method: 'POST', body: {} })
    state.me = null
    go('#/signin')
  },
  'act-as'(button) {
    state.actingAs = button.dataset.id
    draw()
  },
  'clear-acting'() {
    state.actingAs = ''
    draw()
  },
  async weather(data) {
    const result = await api('/api/weather', { method: 'POST', body: { date: state.date, note: data.note } })
    if (result.status !== 200) return fail(result.payload.error)
    go('#/operator', 'Weather saved for the day.')
  },
  async clock(button) {
    const result = await api('/api/clock', { method: 'POST', body: { stopId: button.dataset.id, operatorId: currentOperatorId(), edge: button.dataset.edge } })
    if (result.status !== 200) return fail(result.payload.error)
    go(location.hash, 'Time recorded.')
  },
  'choose-meter-machine'(button) {
    state.meterMachine = button.dataset.id
    draw()
  },
  async 'meter-start'(data) {
    const result = await api('/api/meters/start', { method: 'POST', body: { stopId: data.stopId, machineId: data.machineId, operatorId: currentOperatorId(), readings: { hours: numberOrNull(data.hours), km: numberOrNull(data.km) } } })
    if (result.status !== 200) return fail(result.payload.error)
    go(`#/operator/stop/${data.stopId}`, 'Starting reading saved.')
  },
  async 'meter-end'(data) {
    const result = await api('/api/meters/end', { method: 'POST', body: { stopId: data.stopId, machineId: data.machineId, operatorId: currentOperatorId(), readings: { hours: numberOrNull(data.hours), km: numberOrNull(data.km) } } })
    if (result.status !== 200) return fail(result.payload.error)
    go(`#/operator/stop/${data.stopId}`, 'Ending reading saved.')
  },
  async 'set-sand'(button) {
    const result = await api('/api/sand', { method: 'POST', body: { stopId: button.dataset.id, operatorId: currentOperatorId(), yards: Number(button.dataset.yards) } })
    if (result.status !== 200) return fail(result.payload.error)
    go(location.hash, 'Sand volume saved.')
  },
  async 'add-load'(button) {
    const result = await api('/api/loads', { method: 'POST', body: { stopId: button.dataset.id, operatorId: currentOperatorId() } })
    if (result.status !== 200) return fail(result.payload.error)
    go(location.hash, 'Load counted.')
  },
  async breakdown(data) {
    const result = await api('/api/breakdown', { method: 'POST', body: {
      stopId: data.stopId,
      operatorId: currentOperatorId(),
      toMachineId: state.form.toMachineId,
      ending: { hours: numberOrNull(data.endHours), km: numberOrNull(data.endKm) },
      starting: { hours: numberOrNull(data.startHours), km: numberOrNull(data.startKm) },
      note: data.note,
    } })
    if (result.status !== 200) return fail(result.payload.error)
    go(`#/operator/stop/${data.stopId}`, 'Swap recorded. Nothing was sent.')
  },
  async 'save-preference'() {
    const value = state.form.notifyJobEdges === '' ? null : state.form.notifyJobEdges === '1'
    const result = await api('/api/preference', { method: 'POST', body: { operatorId: currentOperatorId(), notifyJobEdges: value } })
    if (result.status !== 200) return fail(result.payload.error)
    if (state.me.role === 'operator') state.me.notifyJobEdges = value
    go('#/operator', 'Preference saved. Still an open question for the dispatcher.')
  },
}

document.addEventListener('click', (event) => {
  const link = event.target.closest('[data-go]')
  if (link) {
    event.preventDefault()
    go(link.dataset.go)
    return
  }
  const button = event.target.closest('[data-act]')
  if (!button) return
  actions[button.dataset.act]?.(button)
})

document.addEventListener('submit', (event) => {
  const form = event.target
  if (!(form instanceof HTMLFormElement) || !form.dataset.form) return
  event.preventDefault()
  const data = Object.fromEntries(new FormData(form))
  Object.assign(state.form, data)
  actions[form.dataset.form](data)
})

window.addEventListener('hashchange', () => {
  if (!state.holdNotice) state.notice = ''
  state.holdNotice = false
  state.error = ''
  draw()
})

const me = await api('/api/me')
if (me.status === 200) {
  state.me = me.payload.user
  state.date = me.payload.today
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {})
if (!location.hash) location.hash = state.me ? (state.me.role === 'dispatcher' ? '#/home' : '#/operator') : '#/signin'
draw()
