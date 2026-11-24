import { seed } from './seed.js'

function emptyVisit() {
  return {
    clockIn: null,
    clockOut: null,
    weather: null,
    tempC: null,
    iceRock: 0,
    loads: 0,
    notes: '',
    weatherNote: '',
    sms: '',
  }
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-CA', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Edmonton',
  })
}

function formatDuration(startIso, endIso) {
  const mins = Math.max(0, Math.round((new Date(endIso) - new Date(startIso)) / 60000))
  const hours = Math.floor(mins / 60)
  const minutes = mins % 60
  return `${hours}h ${String(minutes).padStart(2, '0')}m`
}

export function createDemoStore() {
  const data = structuredClone(seed)
  const jobIds = [
    ...data.loaderAssignments.map((item) => item.id),
    ...data.sanding.stops.map((item) => item.id),
    ...data.haulQueue.map((item) => item.id),
  ]

  return {
    pane: 'office',
    role: 'loader',
    operatorId: 'op-mara',
    selectedJobId: null,
    notice: '',
    hourError: '',
    endError: '',
    showEndShift: false,
    draftStartHours: '',
    draftEndHours: '',
    draftMachineId: 'ld-12',
    draftImplementId: 'imp-pusher',
    draftPup: true,
    onDemandSiteId: 'site-cedar',
    clock: '',
    driverJobs: [],
    blankJob: { id: '_none', kind: '', siteId: 'site-northgate', title: '', position: null },
    drag: null,
    dropHint: null,
    sites: data.sites,
    operators: data.operators,
    loaders: data.loaders,
    implements: data.implements,
    sanders: data.sanders,
    haulTrucks: data.haulTrucks,
    loaderPairs: data.loaderPairs,
    loaderAssignments: data.loaderAssignments,
    sanding: data.sanding,
    haulQueue: data.haulQueue,
    shifts: Object.fromEntries(data.operators.map((operator) => [operator.id, null])),
    visits: Object.fromEntries([...jobIds, '_none'].map((id) => [id, emptyVisit()])),

    tick() {
      this.clock = new Date().toLocaleTimeString('en-CA', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Edmonton',
      })
    },

    flash(message) {
      this.notice = message
      clearTimeout(this.noticeTimer)
      this.noticeTimer = setTimeout(() => {
        this.notice = ''
      }, 2400)
    },

    site(id) {
      return this.sites.find((item) => item.id === id)
    },

    operatorName(id) {
      return this.operators.find((item) => item.id === id)?.name ?? ''
    },

    operatorsForRole(role = this.role) {
      return this.operators.filter((item) => item.role === role)
    },

    findMachine(id) {
      return [...this.loaders, ...this.sanders, ...this.haulTrucks].find((item) => item.id === id) ?? null
    },

    implementName(id) {
      return this.implements.find((item) => item.id === id)?.name ?? ''
    },

    roleLabel() {
      if (this.role === 'sanding') return 'Sanding driver'
      if (this.role === 'haul') return 'Haul driver'
      return 'Loader operator'
    },

    activeShift() {
      return this.shifts[this.operatorId]
    },

    canLog() {
      const shift = this.activeShift()
      return Boolean(shift && shift.endHours == null)
    },

    ensureVisit(id) {
      if (!this.visits[id]) this.visits[id] = emptyVisit()
      return this.visits[id]
    },

    machinesForRole() {
      if (this.role === 'sanding') return this.sanders
      if (this.role === 'haul') return this.haulTrucks
      return this.loaders
    },

    selectedMachine() {
      return this.findMachine(this.draftMachineId)
    },

    truckHasPup(id) {
      return Boolean(this.haulTrucks.find((item) => item.id === id)?.hasPup)
    },

    syncPupDefault() {
      this.draftPup = this.truckHasPup(this.draftMachineId)
    },

    applyDraftFromAssignment() {
      if (this.role === 'loader') {
        const assignment = this.loaderAssignments.find((item) => item.operatorId === this.operatorId)
        const pair = this.loaderPairs.find((item) => item.operatorId === this.operatorId)
        this.draftMachineId = assignment?.machineId ?? pair?.machineId ?? this.loaders[0].id
        this.draftImplementId = assignment?.implementId ?? pair?.implementId ?? this.implements[0].id
      } else if (this.role === 'sanding') {
        this.draftMachineId = this.sanding.operatorId === this.operatorId
          ? this.sanding.truckId
          : this.sanders[0].id
      } else {
        const stop = this.haulQueue.find((item) => item.operatorId === this.operatorId)
        this.draftMachineId = stop?.truckId ?? this.haulTrucks[0].id
        this.draftPup = this.truckHasPup(this.draftMachineId)
      }
      this.draftStartHours = ''
      this.draftEndHours = ''
    },

    setRole(role) {
      this.role = role
      this.operatorId = this.operatorsForRole(role)[0].id
      this.selectedJobId = null
      this.hourError = ''
      this.endError = ''
      this.showEndShift = false
      this.notice = ''
      if (!this.shifts[this.operatorId]) this.applyDraftFromAssignment()
    },

    onOperatorChange() {
      this.selectedJobId = null
      this.hourError = ''
      this.endError = ''
      this.showEndShift = false
      this.notice = ''
      if (!this.shifts[this.operatorId]) this.applyDraftFromAssignment()
    },

    assignmentsForSite(siteId) {
      return this.loaderAssignments.filter((item) => item.siteId === siteId)
    },

    machineAssigned(machineId) {
      return this.loaderAssignments.some((item) => item.machineId === machineId)
    },

    operatorAssigned(operatorId) {
      return this.loaderAssignments.some((item) => item.operatorId === operatorId)
    },

    siteNameForMachine(machineId) {
      const assignment = this.loaderAssignments.find((item) => item.machineId === machineId)
      return assignment ? this.site(assignment.siteId).name : ''
    },

    operatorPairText(operator) {
      const usual = this.findMachine(operator.usualMachineId)
      const pair = this.loaderPairs.find((item) => item.operatorId === operator.id)
      if (!pair) return `Usual ${usual.name}`
      const now = this.findMachine(pair.machineId)
      if (pair.machineId === operator.usualMachineId) return `${now.name} · ${this.implementName(pair.implementId)}`
      return `${now.name} · usual ${usual.name}`
    },

    machineCardLine(pair) {
      const who = pair.operatorId ? this.operatorName(pair.operatorId).split(' ')[0] : 'Open'
      return `${this.implementName(pair.implementId)} · ${who}`
    },

    assignmentLabel(assignment) {
      const first = this.operatorName(assignment.operatorId).split(' ')[0]
      return `${first} · ${this.findMachine(assignment.machineId).name}`
    },

    clearAssignmentForMachine(machineId) {
      const assignment = this.loaderAssignments.find((item) => item.machineId === machineId)
      if (!assignment) return
      this.loaderAssignments = this.loaderAssignments.filter((item) => item.id !== assignment.id)
      if (this.selectedJobId === assignment.id) this.selectedJobId = null
    },

    refreshLoaderDraft(operatorId) {
      if (this.role !== 'loader' || this.operatorId !== operatorId || this.shifts[operatorId]) return
      this.applyDraftFromAssignment()
    },

    pairOperatorWithMachine(operatorId, machineId) {
      const machine = this.loaderPairs.find((item) => item.machineId === machineId)
      if (!machine || machine.operatorId === operatorId) return
      const displaced = machine.operatorId
      const previous = this.loaderPairs.find((item) => item.operatorId === operatorId)
      if (previous && previous.machineId !== machineId) {
        previous.operatorId = null
        this.clearAssignmentForMachine(previous.machineId)
      }
      machine.operatorId = operatorId
      const assignment = this.loaderAssignments.find((item) => item.machineId === machineId)
      if (assignment) {
        assignment.operatorId = operatorId
        assignment.implementId = machine.implementId
      }
      this.refreshLoaderDraft(operatorId)
      if (displaced) this.refreshLoaderDraft(displaced)
    },

    assignPairToSite(machineId, siteId) {
      const pair = this.loaderPairs.find((item) => item.machineId === machineId)
      if (!pair?.operatorId || !this.site(siteId)) return
      const existing = this.loaderAssignments.find((item) => item.machineId === machineId)
      if (existing) {
        existing.siteId = siteId
        existing.operatorId = pair.operatorId
        existing.implementId = pair.implementId
        return
      }
      const id = `asg-${Math.random().toString(36).slice(2, 8)}`
      this.loaderAssignments.push({
        id,
        siteId,
        operatorId: pair.operatorId,
        machineId,
        implementId: pair.implementId,
      })
      this.ensureVisit(id)
    },

    unassignMachine(machineId) {
      const operatorId = this.loaderAssignments.find((item) => item.machineId === machineId)?.operatorId
      this.clearAssignmentForMachine(machineId)
      if (operatorId) this.refreshLoaderDraft(operatorId)
    },

    dragLabel() {
      if (!this.drag) return ''
      if (this.drag.type === 'operator') return this.operatorName(this.drag.id)
      const pair = this.loaderPairs.find((item) => item.machineId === this.drag.id)
      if (!pair) return ''
      const who = pair.operatorId ? this.operatorName(pair.operatorId) : 'Open machine'
      return `${this.findMachine(pair.machineId).name} · ${who}`
    },

    zoneAt(x, y) {
      const under = document.elementFromPoint(x, y)
      const zone = under?.closest('[data-drop]')
      if (!zone) return null
      return { kind: zone.dataset.drop, id: zone.dataset.id }
    },

    nudgeDragScroll() {
      if (!this.drag?.active) return false
      const y = this.drag.y
      const edge = 72
      const view = window.innerHeight
      let delta = 0
      if (y < edge) delta = -Math.max(8, Math.round(((edge - y) / edge) * 28))
      else if (y > view - edge) delta = Math.max(8, Math.round(((y - (view - edge)) / edge) * 28))
      if (!delta) return false
      const scroller = document.scrollingElement
      const before = scroller.scrollTop
      scroller.scrollTop = before + delta
      return scroller.scrollTop !== before
    },

    beginPointerDrag(event, type, id) {
      if (event.button != null && event.button !== 0) return
      if (event.target.closest('button, a, input, textarea, select')) return
      event.preventDefault()
      const source = event.currentTarget
      const startX = event.clientX
      const startY = event.clientY
      this.drag = { type, id, x: startX, y: startY, active: false }
      const tick = () => {
        if (!this.drag) return
        if (this.nudgeDragScroll()) this.dropHint = this.zoneAt(this.drag.x, this.drag.y)
        this.dragFrame = requestAnimationFrame(tick)
      }
      const move = (pointerEvent) => {
        if (!this.drag) return
        this.drag.x = pointerEvent.clientX
        this.drag.y = pointerEvent.clientY
        if (!this.drag.active && Math.hypot(pointerEvent.clientX - startX, pointerEvent.clientY - startY) > 8) {
          this.drag.active = true
          source.style.pointerEvents = 'none'
        }
        if (this.nudgeDragScroll()) {
          this.dropHint = this.zoneAt(this.drag.x, this.drag.y)
          return
        }
        this.dropHint = this.drag.active ? this.zoneAt(pointerEvent.clientX, pointerEvent.clientY) : null
      }
      const up = (pointerEvent) => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        cancelAnimationFrame(this.dragFrame)
        if (this.drag?.active) {
          const zone = this.zoneAt(pointerEvent.clientX, pointerEvent.clientY)
          if (zone) this.finishDrop(zone.kind, zone.id)
        }
        source.style.pointerEvents = ''
        this.drag = null
        this.dropHint = null
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      this.dragFrame = requestAnimationFrame(tick)
    },

    finishDrop(kind, id) {
      const drag = this.drag
      if (!drag) return
      if (kind === 'machine' && drag.type === 'operator') this.pairOperatorWithMachine(drag.id, id)
      if (kind === 'operator' && drag.type === 'machine') this.pairOperatorWithMachine(id, drag.id)
      if (kind !== 'site') return
      const machineId = drag.type === 'machine'
        ? drag.id
        : this.loaderPairs.find((item) => item.operatorId === drag.id)?.machineId
      if (machineId) this.assignPairToSite(machineId, id)
    },

    openSandSites() {
      const taken = new Set(this.sanding.stops.map((stop) => stop.siteId))
      return this.sites.filter((site) => !taken.has(site.id))
    },

    syncOnDemandPick() {
      const open = this.openSandSites()
      if (!open.some((site) => site.id === this.onDemandSiteId)) {
        this.onDemandSiteId = open[0]?.id ?? ''
      }
    },

    addOnDemand() {
      this.syncOnDemandPick()
      if (!this.onDemandSiteId) return
      const id = `sand-${Math.random().toString(36).slice(2, 8)}`
      this.sanding.stops.push({ id, siteId: this.onDemandSiteId, source: 'ondemand' })
      this.ensureVisit(id)
      this.syncOnDemandPick()
    },

    removeStop(id) {
      this.sanding.stops = this.sanding.stops.filter((stop) => stop.id !== id)
      if (this.selectedJobId === id) this.selectedJobId = null
      this.syncOnDemandPick()
    },

    moveHaul(index, direction) {
      const next = index + direction
      if (next < 0 || next >= this.haulQueue.length) return
      const [row] = this.haulQueue.splice(index, 1)
      this.haulQueue.splice(next, 0, row)
    },

    refreshDriverJobs() {
      this.syncOnDemandPick()
      const operatorId = this.operatorId
      let jobs = []

      if (this.role === 'loader') {
        jobs = this.loaderAssignments
          .filter((item) => item.operatorId === operatorId)
          .map((item) => ({
            id: item.id,
            kind: 'loader',
            siteId: item.siteId,
            operatorId: item.operatorId,
            machineId: item.machineId,
            implementId: item.implementId,
            title: this.site(item.siteId).name,
            meta: `${this.findMachine(item.machineId).name} · ${this.implementName(item.implementId)}`,
          }))
      } else if (this.role === 'sanding' && this.sanding.operatorId === operatorId) {
        const total = this.sanding.stops.length
        jobs = this.sanding.stops.map((stop, index) => ({
          id: stop.id,
          kind: 'sanding',
          siteId: stop.siteId,
          operatorId,
          machineId: this.sanding.truckId,
          title: this.site(stop.siteId).name,
          meta: `Stop ${index + 1} of ${total} · ${this.findMachine(this.sanding.truckId).name}`,
          position: index + 1,
        }))
      } else if (this.role === 'haul') {
        jobs = this.haulQueue
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.operatorId === operatorId)
          .map(({ item, index }) => ({
            id: item.id,
            kind: 'haul',
            siteId: item.siteId,
            operatorId: item.operatorId,
            machineId: item.truckId,
            title: this.site(item.siteId).name,
            meta: this.haulMachineLabel(item.truckId, operatorId),
            position: index + 1,
          }))
      }

      jobs.forEach((job) => this.ensureVisit(job.id))
      this.driverJobs = jobs
      if (this.selectedJobId && !jobs.some((job) => job.id === this.selectedJobId)) {
        this.selectedJobId = null
      }
    },

    haulMachineLabel(truckId, operatorId) {
      const truck = this.findMachine(truckId)
      const shift = this.shifts[operatorId]
      const pup = shift && shift.machineId === truckId ? shift.pup : truck.hasPup
      return pup ? `${truck.name} + pup` : truck.name
    },

    selectedJob() {
      return this.driverJobs.find((job) => job.id === this.selectedJobId) ?? null
    },

    shownJob() {
      return this.selectedJob() || this.blankJob
    },

    allJobs() {
      return [
        ...this.loaderAssignments.map((item) => ({
          id: item.id,
          kind: 'loader',
          siteId: item.siteId,
          operatorId: item.operatorId,
          machineId: item.machineId,
          implementId: item.implementId,
        })),
        ...this.sanding.stops.map((stop) => ({
          id: stop.id,
          kind: 'sanding',
          siteId: stop.siteId,
          operatorId: this.sanding.operatorId,
          machineId: this.sanding.truckId,
        })),
        ...this.haulQueue.map((item) => ({
          id: item.id,
          kind: 'haul',
          siteId: item.siteId,
          operatorId: item.operatorId,
          machineId: item.truckId,
        })),
      ]
    },

    statusLabel(id) {
      const visit = this.visits[id]
      if (!visit?.clockIn) return 'Not started'
      if (!visit.clockOut) return 'On site'
      return 'Done'
    },

    startShift() {
      this.hourError = ''
      const machine = this.findMachine(this.draftMachineId)
      if (!machine) {
        this.hourError = 'Choose a machine.'
        return
      }
      const reading = Number(this.draftStartHours)
      if (!Number.isFinite(reading)) {
        this.hourError = 'Enter the hour-meter reading.'
        return
      }
      if (reading < machine.lastHours) {
        this.hourError = `That reading is below the last meter (${machine.lastHours.toFixed(1)}).`
        return
      }
      this.shifts[this.operatorId] = {
        machineId: machine.id,
        implementId: this.role === 'loader' ? this.draftImplementId : null,
        pup: this.role === 'haul' && machine.hasPup ? this.draftPup : false,
        startHours: reading,
        endHours: null,
      }
      this.flash('Saved on this phone')
    },

    endShift() {
      this.endError = ''
      const shift = this.activeShift()
      const reading = Number(this.draftEndHours)
      if (!shift) return
      if (!Number.isFinite(reading)) {
        this.endError = 'Enter the ending hour-meter reading.'
        return
      }
      if (reading < shift.startHours) {
        this.endError = `Ending hours must be at least the start reading (${shift.startHours.toFixed(1)}).`
        return
      }
      shift.endHours = reading
      const machine = this.findMachine(shift.machineId)
      if (machine) machine.lastHours = reading
      this.showEndShift = false
      this.flash('Saved on this phone')
    },

    engineHoursLabel() {
      const shift = this.activeShift()
      if (!shift || shift.endHours == null) return ''
      return `${(shift.endHours - shift.startHours).toFixed(1)} engine hours`
    },

    shiftMachineLabel() {
      const shift = this.activeShift()
      if (!shift) return ''
      const machine = this.findMachine(shift.machineId)
      const pup = shift.pup ? ' + pup' : ''
      const implement = shift.implementId ? ` · ${this.implementName(shift.implementId)}` : ''
      return `${machine.name}${pup}${implement}`
    },

    composeSms(job, clockIn) {
      const site = this.site(job.siteId)
      const time = formatTime(clockIn).replace(/\.$/, '')
      const windowText = '45–75 min'
      let place = 'Loader is on site.'
      if (job.kind === 'haul') {
        const position = this.haulQueue.findIndex((item) => item.id === job.id) + 1
        place = `You are #${position} in the haul queue.`
      } else if (job.kind === 'sanding') {
        const position = this.sanding.stops.findIndex((item) => item.id === job.id) + 1
        place = `You are stop ${position} of ${this.sanding.stops.length} on the sanding route.`
      }
      return `Kakwa: Arrived at ${site.name} at ${time}. ${place} Estimated window ${windowText}.`
    },

    clockIn(job) {
      if (!job?.id || job.id === '_none' || !this.canLog()) return
      const visit = this.ensureVisit(job.id)
      if (visit.clockIn) return
      visit.clockIn = new Date().toISOString()
      visit.sms = this.composeSms(job, visit.clockIn)
      this.flash('Saved on this phone')
    },

    clockOut(job) {
      if (!job?.id || job.id === '_none' || !this.canLog()) return
      const visit = this.ensureVisit(job.id)
      if (!visit.clockIn || visit.clockOut) return
      visit.clockOut = new Date().toISOString()
      this.flash('Saved on this phone')
    },

    saveWeatherNote(job) {
      const visit = this.visits[job?.id]
      if (!visit?.clockOut) return
      this.flash(visit.weatherNote.trim() ? 'Weather note kept on this phone' : 'Weather note cleared')
    },

    bumpIce(id, delta) {
      if (!this.canLog()) return
      const visit = this.ensureVisit(id)
      visit.iceRock = Math.max(0, Math.round((Number(visit.iceRock) + delta) * 10) / 10)
      this.flash('Saved on this phone')
    },

    bumpLoads(id, delta) {
      if (!this.canLog()) return
      const visit = this.ensureVisit(id)
      visit.loads = Math.max(0, visit.loads + delta)
      this.flash('Saved on this phone')
    },

    saveNotes() {
      if (!this.canLog()) return
      this.flash('Saved on this phone')
    },

    billableLabel(id) {
      const visit = this.visits[id]
      if (!visit?.clockIn) return ''
      if (!visit.clockOut) return 'On site'
      return `${formatDuration(visit.clockIn, visit.clockOut)} on site`
    },

    positionText(job) {
      if (!job?.position) return ''
      if (job.kind === 'sanding') return `Stop ${job.position} of ${this.sanding.stops.length}`
      return `Priority #${job.position}`
    },

    detailFor(job, visit) {
      let base = ''
      if (job.kind === 'sanding') base = `${Number(visit.iceRock).toFixed(1)} yd ice rock`
      if (job.kind === 'haul') {
        const notes = visit.notes.trim() ? ` · ${visit.notes.trim()}` : ''
        const noun = visit.loads === 1 ? 'load' : 'loads'
        base = `${visit.loads} ${noun}${notes}`
      }
      const weather = (visit.weatherNote || '').trim()
      if (weather && base) return `${base} · ${weather}`
      if (weather) return weather
      return base || 'Weather not logged'
    },

    machineSummary(job) {
      const shift = this.shifts[job.operatorId]
      if (shift) {
        const machine = this.findMachine(shift.machineId)
        const pup = shift.pup ? ' + pup' : ''
        const implement = shift.implementId ? ` · ${this.implementName(shift.implementId)}` : ''
        return `${machine.name}${pup}${implement}`
      }
      if (job.kind === 'loader') {
        return `${this.findMachine(job.machineId).name} · ${this.implementName(job.implementId)}`
      }
      if (job.kind === 'haul') return this.haulMachineLabel(job.machineId, job.operatorId)
      return this.findMachine(job.machineId).name
    },

    readout() {
      return this.allJobs()
        .map((job) => ({ job, visit: this.visits[job.id] }))
        .filter((row) => row.visit?.clockIn)
        .sort((a, b) => a.visit.clockIn.localeCompare(b.visit.clockIn))
        .map(({ job, visit }) => ({
          id: job.id,
          timeIn: formatTime(visit.clockIn),
          timeOut: visit.clockOut ? formatTime(visit.clockOut) : '—',
          billable: visit.clockOut ? formatDuration(visit.clockIn, visit.clockOut) : 'On site',
          who: this.operatorName(job.operatorId),
          machine: this.machineSummary(job),
          site: this.site(job.siteId).name,
          detail: this.detailFor(job, visit),
        }))
    },

    shiftSummaries() {
      return this.operators
        .filter((operator) => this.shifts[operator.id])
        .map((operator) => {
          const shift = this.shifts[operator.id]
          const machine = this.findMachine(shift.machineId)
          const pup = shift.pup ? ' + pup' : ''
          const implement = shift.implementId ? ` · ${this.implementName(shift.implementId)}` : ''
          const engine = shift.endHours == null
            ? 'Shift open'
            : `${(shift.endHours - shift.startHours).toFixed(1)} engine h`
          return {
            id: operator.id,
            label: `${operator.name} · ${machine.name}${pup}${implement}`,
            detail: `Start ${shift.startHours.toFixed(1)} · ${engine}`,
          }
        })
    },

    latestSms() {
      const rows = Object.values(this.visits)
        .filter((visit) => visit?.sms)
        .sort((a, b) => b.clockIn.localeCompare(a.clockIn))
      return rows[0]?.sms ?? ''
    },

    sampleSms() {
      return 'Kakwa: Arrived at Pinnacle Industrial at 6:42 p.m. You are #1 in the haul queue. Estimated window 45–75 min.'
    },
  }
}
