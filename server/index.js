import { openDatabase } from './db.js'
import { startServer } from './app.js'

const file = process.env.KAKWA_DB || 'data/kakwa.sqlite'
const db = openDatabase(file)
const port = Number(process.env.PORT || 8787)
const server = await startServer(db, port)
console.log(`Kakwa Dispatch API on http://127.0.0.1:${server.address().port}`)
