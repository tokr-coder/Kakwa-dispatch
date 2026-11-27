import { openDatabase } from './db.js'
import { startServer } from './app.js'

const db = openDatabase()
const port = Number(process.env.PORT || 8787)
const server = await startServer(db, port)
console.log(`Kakwa Dispatch API on http://127.0.0.1:${server.address().port}`)
