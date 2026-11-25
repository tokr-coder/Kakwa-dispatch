import { seed } from './seed.js'

function emptyDraft() {
  return {
    siteId: null,
    placement: 'after',
    machineIds: [],
    operators: {},
    driverIndex: 0,
  }
}

export function createDemoStore() {
  const data = structuredClone(seed)

  return {
    screen: 'plan',
    notice: '',
    sites: data.sites,
    machines: data.machines,
    operators: data.operators,
    plan: [],
    draft: emptyDraft(),

    site(id) {
      return this.sites.find((item) => item.id === id)
    },

    machine(id) {
      return this.machines.find((item) => item.id === id)
    },

    operator(id) {
      return this.operators.find((item) => item.id === id)
    },

    operatorName(id) {
      return this.operator(id)?.name ?? ''
    },

    usualOperator(machineId) {
      return this.operators.find((item) => item.usualMachineId === machineId) ?? null
    },

    siteInPlan(siteId) {
      return this.plan.some((step) => step.sites.some((item) => item.siteId === siteId))
    },

    draftSite() {
      return this.site(this.draft.siteId) ?? { id: '', name: '', address: '', services: [] }
    },

    targetStepIndex() {
      if (!this.plan.length || this.draft.placement === 'after') return this.plan.length
      return this.plan.length - 1
    },

    crewInStep(stepIndex) {
      const step = this.plan[stepIndex]
      if (!step) return []
      return step.sites.flatMap((item) => item.crew)
    },

    priorUse(kind, id, beforeIndex) {
      for (let index = beforeIndex - 1; index >= 0; index -= 1) {
        const hit = this.plan[index].sites.find((item) => item.crew.some((seat) => seat[kind] === id))
        if (hit) return this.site(hit.siteId).name
      }
      return ''
    },

    machineChoice(machineId) {
      const machine = this.machine(machineId)
      const needed = this.draftSite()?.services.includes(machine.service)
      if (!needed) return { state: 'unneeded' }
      const target = this.targetStepIndex()
      const busy = this.crewInStep(target).find((seat) => seat.machineId === machineId)
      if (busy) return { state: 'taken', where: this.site(this.plan[target].sites.find((item) => item.crew.some((seat) => seat.machineId === machineId)).siteId).name }
      const from = this.priorUse('machineId', machineId, target)
      if (from) return { state: 'coming', where: from }
      return { state: 'free' }
    },

    driverChoice(operatorId, machineId) {
      const target = this.targetStepIndex()
      const onThisMachine = this.draft.operators[machineId] === operatorId
      const inDraft = this.draft.machineIds.some((id) => id !== machineId && this.draft.operators[id] === operatorId)
      const inStep = this.crewInStep(target).some((seat) => seat.operatorId === operatorId)
      if ((inDraft || inStep) && !onThisMachine) {
        return { state: 'taken' }
      }
      const from = this.priorUse('operatorId', operatorId, target)
      if (from) return { state: 'coming', where: from }
      return { state: 'free' }
    },

    currentDriverMachine() {
      return this.machine(this.draft.machineIds[this.draft.driverIndex]) ?? { id: '', name: '', detail: '', service: '' }
    },

    startPlan() {
      this.notice = ''
      this.draft = emptyDraft()
      this.screen = 'site'
    },

    pickSite(siteId) {
      if (this.siteInPlan(siteId)) return
      this.notice = ''
      this.draft = emptyDraft()
      this.draft.siteId = siteId
      this.screen = this.plan.length ? 'when' : 'machines'
    },

    pickWhen(placement) {
      this.draft.placement = placement
      this.draft.machineIds = []
      this.draft.operators = {}
      this.screen = 'machines'
    },

    toggleMachine(machineId) {
      const choice = this.machineChoice(machineId)
      if (choice.state === 'unneeded' || choice.state === 'taken') return
      const selected = this.draft.machineIds.includes(machineId)
      if (selected) {
        this.draft.machineIds = this.draft.machineIds.filter((id) => id !== machineId)
        delete this.draft.operators[machineId]
        return
      }
      this.draft.machineIds.push(machineId)
      const usual = this.usualOperator(machineId)
      if (usual && this.driverChoice(usual.id, machineId).state !== 'taken') {
        this.draft.operators[machineId] = usual.id
      }
    },

    goToDrivers() {
      if (!this.draft.machineIds.length) return
      this.draft.driverIndex = 0
      this.screen = 'drivers'
    },

    pickDriver(operatorId) {
      const machine = this.currentDriverMachine()
      if (!machine) return
      const choice = this.driverChoice(operatorId, machine.id)
      if (choice.state === 'taken') {
        this.notice = `${this.operatorName(operatorId)} is already on a machine in this step.`
        return
      }
      this.notice = ''
      this.draft.operators[machine.id] = operatorId
    },

    nextDriver() {
      const machine = this.currentDriverMachine()
      if (!machine || !this.draft.operators[machine.id]) return
      if (this.draft.driverIndex < this.draft.machineIds.length - 1) {
        this.draft.driverIndex += 1
        this.notice = ''
        return
      }
      this.screen = 'confirm'
    },

    prevDriver() {
      if (this.draft.driverIndex > 0) {
        this.draft.driverIndex -= 1
        return
      }
      this.screen = 'machines'
    },

    addToPlan() {
      const crew = this.draft.machineIds.map((machineId) => ({
        machineId,
        operatorId: this.draft.operators[machineId],
      }))
      if (!crew.length || crew.some((seat) => !seat.operatorId)) return
      const entry = {
        id: `stop-${Math.random().toString(36).slice(2, 8)}`,
        siteId: this.draft.siteId,
        crew,
      }
      if (!this.plan.length || this.draft.placement === 'after') {
        this.plan.push({ id: `step-${Math.random().toString(36).slice(2, 8)}`, sites: [entry] })
      } else {
        this.plan[this.plan.length - 1].sites.push(entry)
      }
      this.draft = emptyDraft()
      this.notice = ''
      this.screen = 'plan'
    },

    back() {
      this.notice = ''
      if (this.screen === 'site') this.screen = 'plan'
      else if (this.screen === 'when') this.screen = 'site'
      else if (this.screen === 'machines') this.screen = this.plan.length ? 'when' : 'site'
      else if (this.screen === 'drivers') this.prevDriver()
      else if (this.screen === 'confirm') this.screen = 'drivers'
    },

    conflictWith(entry, stepIndex) {
      const seats = this.crewInStep(stepIndex)
      for (const seat of entry.crew) {
        if (seats.some((other) => other.machineId === seat.machineId)) {
          const site = this.plan[stepIndex].sites.find((item) => item.crew.some((other) => other.machineId === seat.machineId))
          return `${this.machine(seat.machineId).name} is already on ${this.site(site.siteId).name} in that step.`
        }
      }
      return ''
    },

    moveSite(stepIndex, siteIndex, direction) {
      this.notice = ''
      const step = this.plan[stepIndex]
      const entry = step.sites[siteIndex]
      const targetIndex = stepIndex + direction
      const aloneAtEnd = direction > 0 && stepIndex === this.plan.length - 1 && step.sites.length === 1
      if (targetIndex < 0 || aloneAtEnd) return
      if (targetIndex < this.plan.length) {
        const message = this.conflictWith(entry, targetIndex)
        if (message) {
          this.notice = message
          return
        }
      }
      step.sites.splice(siteIndex, 1)
      let dest = targetIndex
      if (!step.sites.length) {
        this.plan.splice(stepIndex, 1)
        if (direction > 0) dest -= 1
      }
      if (dest >= this.plan.length) {
        this.plan.push({ id: `step-${Math.random().toString(36).slice(2, 8)}`, sites: [entry] })
      } else {
        this.plan[dest].sites.push(entry)
      }
    },

    canMove(stepIndex, siteIndex, direction) {
      const step = this.plan[stepIndex]
      if (direction < 0) return stepIndex > 0
      return !(stepIndex === this.plan.length - 1 && step.sites.length === 1)
    },

    placementLabel() {
      if (!this.plan.length || this.draft.placement === 'after') return `Step ${this.plan.length + 1}`
      return `With step ${this.plan.length}`
    },
  }
}
