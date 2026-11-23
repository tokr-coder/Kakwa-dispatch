import Alpine from 'alpinejs'
import { createDemoStore } from './store.js'
import './style.css'

const demo = createDemoStore()
demo.refreshDriverJobs()

Alpine.store('demo', demo)

const store = Alpine.store('demo')
store.tick()
setInterval(() => store.tick(), 15000)

window.Alpine = Alpine
Alpine.start()
