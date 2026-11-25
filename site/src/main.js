import Alpine from 'alpinejs'
import { createDemoStore } from './store.js'
import './style.css'

Alpine.store('demo', createDemoStore())
window.Alpine = Alpine
Alpine.start()
